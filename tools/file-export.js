"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { v7: uuidv7 } = require("uuid");

const DEFAULT_EXPORT_ALLOWED_EXTENSIONS = [
  ".pdf",
  ".doc",
  ".docx",
  ".rtf",
  ".odt",
  ".xls",
  ".xlsx",
  ".xlsm",
  ".csv",
  ".tsv",
  ".ppt",
  ".pptx",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".tif",
  ".tiff",
  ".txt",
  ".md",
  ".json",
  ".xml",
  ".zip",
];
const BLOCKED_EXPORT_EXTENSIONS = new Set([
  ".apk",
  ".app",
  ".com",
  ".cpl",
  ".dll",
  ".exe",
  ".bat",
  ".cmd",
  ".msi",
  ".ps1",
  ".vbs",
  ".vb",
  ".vbe",
  ".js",
  ".jse",
  ".jar",
  ".lnk",
  ".reg",
  ".scr",
  ".sh",
  ".wsf",
]);
const RESERVED_WINDOWS_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

function normalizeExtension(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (!text) return "";
  return text.startsWith(".") ? text : `.${text}`;
}

function normalizeExportDirectoryConfig(rawConfig) {
  const raw = rawConfig || {};
  const allowedExtensions = Array.isArray(raw.allowedExtensions)
    ? raw.allowedExtensions
        .filter((item) => typeof item === "string")
        .map((item) => normalizeExtension(item))
        .filter(Boolean)
    : DEFAULT_EXPORT_ALLOWED_EXTENSIONS;
  const maxBytes = Number(raw.maxBytes);
  const conflictPolicy = ["fail", "rename", "overwrite"].includes(
    raw.conflictPolicy,
  )
    ? raw.conflictPolicy
    : "rename";
  return {
    enabled: raw.enabled === true,
    path: typeof raw.path === "string" ? raw.path.trim() : "",
    displayName:
      typeof raw.displayName === "string" ? raw.displayName.trim() : "",
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 52428800,
    allowedExtensions:
      allowedExtensions.length > 0
        ? Array.from(new Set(allowedExtensions))
        : DEFAULT_EXPORT_ALLOWED_EXTENSIONS,
    conflictPolicy,
  };
}

function getExportCapability(rawConfig) {
  const config = normalizeExportDirectoryConfig(rawConfig);
  const enabled = config.enabled && !!config.path;
  return {
    enabled,
    displayName:
      config.displayName ||
      (config.path ? path.basename(config.path) : "Shared export"),
    maxBytes: config.maxBytes,
    allowedExtensions: config.allowedExtensions,
    conflictPolicy: config.conflictPolicy,
  };
}

function createExportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sanitizeExportFileName(fileName) {
  const original = String(fileName || "").trim();
  if (!original) {
    throw createExportError("FILE_NAME_REQUIRED", "文件名不能为空");
  }
  if (
    original.includes("/") ||
    original.includes("\\") ||
    original.includes(":") ||
    original.includes("\0")
  ) {
    throw createExportError("FILE_NAME_INVALID", "文件名不能包含路径片段");
  }
  const baseName = path
    .basename(original)
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, "_");
  const parsed = path.parse(baseName);
  if (!parsed.name || RESERVED_WINDOWS_NAMES.has(parsed.name.toLowerCase())) {
    throw createExportError("FILE_NAME_RESERVED", "文件名为系统保留名称");
  }
  return baseName;
}

function decodeExportPayload(task) {
  if (!task || task.mode !== "binary") {
    throw createExportError("UNSUPPORTED_MODE", "仅支持 binary 导出模式");
  }
  if (typeof task.payload !== "string" || !task.payload) {
    throw createExportError("PAYLOAD_REQUIRED", "导出内容不能为空");
  }
  let buffer;
  try {
    buffer = Buffer.from(task.payload, "base64");
  } catch {
    throw createExportError("PAYLOAD_INVALID", "导出内容不是合法 base64");
  }
  if (task.size != null && Number(task.size) !== buffer.length) {
    throw createExportError("SIZE_MISMATCH", "导出内容大小校验失败");
  }
  return buffer;
}

function ensureExportPathInsideRoot(rootPath, fileName) {
  const root = fs.realpathSync(rootPath);
  const target = path.resolve(root, fileName);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw createExportError("PATH_OUTSIDE_ROOT", "导出路径超出授权目录");
  }
  return target;
}

function resolveExportConflict(target, policy) {
  if (!fs.existsSync(target)) return target;
  if (policy === "fail") {
    throw createExportError("FILE_EXISTS", "目标文件已存在");
  }
  if (policy === "overwrite") return target;

  const parsed = path.parse(target);
  for (let index = 1; index <= 999; index += 1) {
    const candidate = path.join(
      parsed.dir,
      `${parsed.name} (${index})${parsed.ext}`,
    );
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw createExportError("FILE_RENAME_EXHAUSTED", "无法生成不重复文件名");
}

function handleFileExportTask(client, task, rawConfig) {
  const replyId = task && task.replyId;
  const taskId = (task && task.taskId) || uuidv7();
  let tempPath = "";
  const emitError = (err) => {
    client.emit("file.export.error", {
      taskId,
      replyId,
      code: err.code || "FILE_EXPORT_FAILED",
      message: err.message || "文件导出失败",
    });
  };

  try {
    const config = normalizeExportDirectoryConfig(rawConfig);
    if (!config.enabled || !config.path) {
      throw createExportError(
        "FILE_EXPORT_DISABLED",
        "客户端未启用共享导出目录",
      );
    }
    fs.accessSync(config.path, fs.constants.W_OK);
    const fileName = sanitizeExportFileName(task && task.fileName);
    const extension = normalizeExtension(path.extname(fileName));
    if (!extension || BLOCKED_EXPORT_EXTENSIONS.has(extension)) {
      throw createExportError("FILE_EXTENSION_BLOCKED", "文件扩展名被禁止");
    }
    if (!config.allowedExtensions.includes(extension)) {
      throw createExportError(
        "FILE_EXTENSION_NOT_ALLOWED",
        "文件扩展名未被允许",
      );
    }

    const buffer = decodeExportPayload(task);
    if (buffer.length > config.maxBytes) {
      throw createExportError("FILE_TOO_LARGE", "导出文件超过客户端大小限制");
    }
    if (task.sha256) {
      const digest = crypto
        .createHash("sha256")
        .update(buffer)
        .digest("hex");
      if (digest.toLowerCase() !== String(task.sha256).toLowerCase()) {
        throw createExportError("CHECKSUM_MISMATCH", "导出文件校验失败");
      }
    }

    const target = resolveExportConflict(
      ensureExportPathInsideRoot(config.path, fileName),
      task.conflictPolicy || config.conflictPolicy,
    );
    tempPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, buffer, { flag: "wx" });
    fs.renameSync(tempPath, target);
    tempPath = "";
    client.emit("file.export.success", {
      taskId,
      replyId,
      fileName: path.basename(target),
      displayPath: `${getExportCapability(config).displayName}/${path.basename(
        target,
      )}`,
      bytes: buffer.length,
      sha256: task.sha256,
    });
  } catch (err) {
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup; the export error is reported below.
      }
    }
    emitError(err);
  }
}

module.exports = {
  normalizeExportDirectoryConfig,
  getExportCapability,
  handleFileExportTask,
};
