const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const childProcess = require("child_process");
const net = require("net");
const { app, Notification, dialog, clipboard, shell } = require("electron");
const address = require("address");
const ipp = require("ipp");
const { machineIdSync } = require("node-machine-id");
const Store = require("electron-store");
const { v7: uuidv7 } = require("uuid");
const { getLatestCompatiblePluginVersion } = require("../src/plugin-package");

/**
 * win32-pdf-printer 的 paper-size-info.exe 会被 electron-builder 解压到 app.asar.unpacked。
 * 运行环境下它仍然使用 app.asar 路径，导致文件不存在。这里提前重写 child_process 的执行路径。
 */
function patchWin32PdfPrinterBinPath() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const pattern = /app\.asar([\\/])(?=node_modules[\\/]win32-pdf-printer[\\/]paper-size-info\.exe)/i;
  const unpackedSegment = "app.asar.unpacked";
  const unpackedBin = path.join(
    process.resourcesPath,
    unpackedSegment,
    "node_modules",
    "win32-pdf-printer",
    "paper-size-info.exe",
  );
  if (!fs.existsSync(unpackedBin)) return;

  const rewriteCommand = (command) => {
    if (typeof command !== "string" || !pattern.test(command)) return command;
    if (command.includes(unpackedSegment)) return command;
    const replaced = command.replace(pattern, `${unpackedSegment}$1`);
    // 仅包裹 exe 路径，避免把参数一起包进引号导致命令解析失败
    const unpackedBinNormalized = unpackedBin.replace(/\\/g, "/");
    const quoteIfNeeded = (exePath) =>
      exePath.includes(" ") ? `"${exePath}"` : exePath;
    if (
      replaced.startsWith(`"${unpackedBin}"`) ||
      replaced.startsWith(`"${unpackedBinNormalized}"`)
    ) {
      return replaced;
    }
    if (replaced === unpackedBin || replaced === unpackedBinNormalized) {
      return quoteIfNeeded(replaced);
    }
    if (replaced.startsWith(unpackedBin + " ")) {
      return `${quoteIfNeeded(unpackedBin)}${replaced.slice(
        unpackedBin.length,
      )}`;
    }
    if (replaced.startsWith(unpackedBinNormalized + " ")) {
      return `${quoteIfNeeded(unpackedBinNormalized)}${replaced.slice(
        unpackedBinNormalized.length,
      )}`;
    }
    return replaced;
  };

  const wrap = (original) =>
    function patched(command, ...args) {
      return original.call(childProcess, rewriteCommand(command), ...args);
    };

  childProcess.execFile = wrap(childProcess.execFile);
  childProcess.exec = wrap(childProcess.exec);
  childProcess.execSync = wrap(childProcess.execSync);
  const spawn = childProcess.spawn;
  childProcess.spawn = function(command, ...args) {
    return spawn.call(childProcess, rewriteCommand(command), ...args);
  };
  const spawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function(command, ...args) {
    return spawnSync.call(childProcess, rewriteCommand(command), ...args);
  };
}

patchWin32PdfPrinterBinPath();

const { getPaperSizeInfo, getPaperSizeInfoAll } = require("win32-pdf-printer");
const db = require("./database");
let buildInfo = {};
const buildInfoPath = path.join(__dirname, "../build-info.json");
if (fs.existsSync(buildInfoPath)) {
  buildInfo = require(buildInfoPath);
}

Store.initRenderer();

function getDefaultPluginVersion() {
  const pluginDir = app.isPackaged
    ? path.join(app.getAppPath(), "../", "plugin")
    : path.join(app.getAppPath(), "plugin");
  return getLatestCompatiblePluginVersion(pluginDir);
}

const schema = {
  mainTitle: {
    type: "string",
    default: "Electron-hiprint",
  },
  nickName: {
    type: "string",
    default: "",
  },
  openAtLogin: {
    type: "boolean",
    default: true,
  },
  openAsHidden: {
    type: "boolean",
    default: true,
  },
  connectTransit: {
    type: "boolean",
    default: false,
  },
  transitUrl: {
    type: "string",
    default: "",
  },
  transitToken: {
    type: "string",
    default: "",
  },
  allowNotify: {
    type: "boolean",
    default: true,
  },
  closeType: {
    type: "string",
    enum: ["tray", "quit"],
    default: "tray",
  },
  port: {
    type: "number",
    minimum: 10000,
    default: 17521,
  },
  bindHost: {
    type: "string",
    default: "127.0.0.1",
  },
  allowedOrigins: {
    type: "array",
    default: [],
    items: {
      type: "string",
    },
  },
  allowedIppHosts: {
    type: "array",
    default: [],
    items: {
      type: "string",
    },
  },
  token: {
    type: ["string", "null"],
    default: null,
  },
  pluginVersion: {
    type: "string",
    default: getDefaultPluginVersion(),
  },
  logPath: {
    type: "string",
    default: app.getPath("logs"),
  },
  pdfPath: {
    type: "string",
    default: app.getPath("temp"),
  },
  defaultPrinter: {
    type: "string",
    default: "",
  },
  exportDirectory: {
    type: "object",
    default: {
      enabled: false,
      path: "",
      displayName: "",
      maxBytes: 52428800,
      allowedExtensions: [
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
      ],
      conflictPolicy: "rename",
    },
  },
  disabledGpu: {
    type: "boolean",
    default: false,
  },
  rePrint: {
    type: "boolean",
    default: true,
  },
};

const store = new Store({ schema });

function generateAuthToken() {
  return crypto.randomBytes(16).toString("hex");
}

function ensureAuthToken() {
  const token = store.get("token");
  if (typeof token === "string" && token.length > 0) return token;
  const generatedToken = generateAuthToken();
  store.set("token", generatedToken);
  return generatedToken;
}

/**
 * @description: 获取当前系统 IP 地址
 * @return {String}
 */
function addressIp() {
  return address.ip();
}

/**
 * @description: 获取当前系统 IPV6 地址
 * @return {String}
 */
function addressIpv6() {
  return address.ipv6();
}

/**
 * @description: 获取当前系统 MAC 地址
 * @return {String}
 */
function addressMac() {
  return new Promise((resolve) => {
    address.mac(function(err, addr) {
      if (err) {
        // 获取失败返回空串而非 Error 对象，避免 clientInfo.mac 被填成序列化错误对象
        resolve("");
      } else {
        resolve(addr);
      }
    });
  });
}

/**
 * @description: 获取当前系统 IP、IPV6、MAC 地址
 * @return {Object}
 */
function addressAll() {
  return new Promise((resolve) => {
    address.mac(function(err, mac) {
      if (err) {
        // 获取失败返回空串而非 Error 对象，避免 mac 被填成序列化错误对象透传到 UI 和客户端
        resolve({ ip: address.ip(), ipv6: address.ipv6(), mac: "" });
      } else {
        resolve({ ip: address.ip(), ipv6: address.ipv6(), mac });
      }
    });
  });
}

/**
 * @description: address 方法重写
 * @return {Object}
 */
const _address = {
  ip: addressIp,
  ipv6: addressIpv6,
  mac: addressMac,
  all: addressAll,
};

/**
 * @description: 检查分片任务实例，用于自动删除超时分片信息
 */
const watchTaskInstance = generateWatchTask(
  () => global.PRINT_FRAGMENTS_MAPPING,
)();

/**
 * @description: 尝试获取客户端唯一id，依赖管理员权限与注册表读取
 * @return {string}
 */
function getMachineId() {
  try {
    return machineIdSync({ original: true });
  } catch (error) {
    // 若获取失败，也可以使用 UUID 代替，需要单独存储 首次创建 后续读取
    // 默认返回空 表示读不到就好；记录错误以便打包后从日志文件排查
    console.error("getMachineId failed", error);
    return "";
  }
}

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

function normalizeExportDirectoryConfig() {
  const raw = store.get("exportDirectory") || {};
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

function getExportCapability() {
  const config = normalizeExportDirectoryConfig();
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

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
}

function getAllowedIppHosts() {
  const configured = store.get("allowedIppHosts");
  return Array.isArray(configured)
    ? configured.map(normalizeHost).filter(Boolean)
    : [];
}

function isBlockedIPv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isBlockedIPv6(hostname) {
  const normalized = normalizeHost(hostname);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function getIppTargetError(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return createIppTargetError("IPP URL 格式无效");
  }

  if (!["http:", "https:", "ipp:", "ipps:"].includes(parsed.protocol)) {
    return createIppTargetError("IPP URL 协议不被允许");
  }

  const hostname = normalizeHost(parsed.hostname);
  const allowedHosts = getAllowedIppHosts();
  if (allowedHosts.includes("*") || allowedHosts.includes(hostname)) {
    return null;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return createIppTargetError("IPP URL 不能指向本机地址");
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isBlockedIPv4(hostname)) {
    return createIppTargetError("IPP URL 不能指向内网或保留 IPv4 地址");
  }
  if (ipVersion === 6 && isBlockedIPv6(hostname)) {
    return createIppTargetError("IPP URL 不能指向内网或保留 IPv6 地址");
  }

  return null;
}

function createIppTargetError(message) {
  const error = new Error(message);
  error.name = "InvalidIppTarget";
  return error;
}

/**
 * @description: 校验对端可控的 http(s) 下载地址，拦截 SSRF（如 url_pdf 打印类型）。
 *   仅放行 http/https，拒绝 localhost 与内网/保留 IPv4/IPv6 字面量地址。
 *   注意：此处只校验 URL 中的字面量主机；域名解析到内网的 DNS 重绑定由调用方
 *   在连接前对解析后的 IP 再做一次 isBlockedIPv4/isBlockedIPv6 校验。
 * @param {string} rawUrl 待校验的 URL
 * @return {Error|null} 不合法时返回 Error，合法返回 null
 */
function getHttpUrlTargetError(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return new Error("下载地址格式无效");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return new Error("仅允许 http/https 协议");
  }
  const hostname = normalizeHost(parsed.hostname);
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    return new Error("下载地址不能指向本机地址");
  }
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isBlockedIPv4(hostname)) {
    return new Error("下载地址不能指向内网或保留 IPv4 地址");
  }
  if (ipVersion === 6 && isBlockedIPv6(hostname)) {
    return new Error("下载地址不能指向内网或保留 IPv6 地址");
  }
  return null;
}

function normalizeExtension(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();
  if (!text) return "";
  return text.startsWith(".") ? text : `.${text}`;
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

function createExportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function handleFileExportTask(client, task) {
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
    const config = normalizeExportDirectoryConfig();
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
      displayPath: `${getExportCapability().displayName}/${path.basename(
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

/**
 * @description: 抛出当前客户端信息，提供更多有价值的信息，逐步替换原有 address
 * @param {io.Socket} socket
 * @return {void}
 */
function emitClientInfo(socket) {
  _address
    .mac()
    .then((mac) => {
      const defaultPrinter = store.get("defaultPrinter", "");
      const bindHost = store.get("bindHost") || "127.0.0.1";
      const clientHost =
        bindHost === "0.0.0.0" || bindHost === "::" ? _address.ip() : bindHost;
      socket.emit("clientInfo", {
        hostname: os.hostname(), // 主机名
        version: app.getVersion(), // 版本号
        platform: process.platform, // 平台
        arch: process.arch, // 系统架构
        mac: mac, // mac 地址
        ip: _address.ip(), // ip 地址
        ipv6: _address.ipv6(), // ipv6 地址
        clientUrl: `http://${clientHost}:${store.get("port") || 17521}`, // 客户端地址
        machineId: getMachineId(), // 客户端唯一id
        nickName: store.get("nickName"), // 客户端昵称
        defaultPrinter, // 客户端高级设置里的默认打印机
        capabilities: {
          print: { enabled: true },
          fileExport: getExportCapability(),
        },
      });
    })
    .catch((err) => {
      // _address.mac() 不会 reject，但 then 体内（如 socket.emit）若同步抛出，
      // 无 catch 会成为不可见的 unhandledRejection；记录以便排查
      console.error("emitClientInfo failed", err);
    });
}

async function getConfiguredPrinterList() {
  const defaultPrinter = store.get("defaultPrinter", "");
  const printers = await MAIN_WINDOW.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    ...printer,
    defaultPrinter,
    configuredDefault: !!defaultPrinter && printer.name === defaultPrinter,
  }));
}

/**
 * 生成检查分片任务的闭包函数
 * @param {Object} getCheckTarget 获取校验对象，最后会得到global.PRINT_FRAGMENTS_MAPPING
 * @returns {Function}
 */
function generateWatchTask(getCheckTarget) {
  // 记录当前检查任务是否开启，避免重复开启任务
  let isWatching = false;
  /**
   * @description: 检查分片任务实例创建函数
   * @param {Object} config 检查参数，根据实际情况调整
   * @param {number} [config.checkInterval=5] 执行内存检查的时间间隔，单位分钟
   * @param {number} [config.expire=10] 分片信息过期时间，单位分钟，不应过小
   */
  return function generateWatchTaskInstance(config = {}) {
    // 合并用户和默认配置
    const realConfig = Object.assign(
      {
        checkInterval: 5, // 默认检查间隔
        expire: 10, // 默认过期时间
      },
      config,
    );
    return {
      startWatch() {
        if (isWatching) return;
        this.createWatchTimeout();
      },
      createWatchTimeout() {
        // 更新开关状态
        isWatching = true;
        return setTimeout(
          this.clearFragmentsWhichIsExpired.bind(this),
          realConfig.checkInterval * 60 * 1000,
        );
      },
      clearFragmentsWhichIsExpired() {
        const checkTarget = getCheckTarget();
        const currentTimeStamp = Date.now();
        Object.entries(checkTarget).map(([id, fragmentInfo]) => {
          // 获取任务最后更新时间
          const { updateTime } = fragmentInfo;
          // 任务过期时，清除任务信息释放内存
          if (currentTimeStamp - updateTime > realConfig.expire * 60 * 1000) {
            delete checkTarget[id];
          }
        });
        // 获取剩余任务数量
        const printTaskCount = Object.keys(checkTarget).length;
        // 还有打印任务，继续创建检查任务
        if (printTaskCount) this.createWatchTimeout();
        // 更新开关状态
        else isWatching = false;
      },
    };
  };
}

/**
 * SQLite bound-parameter limit
 */
const SQLITE_MAX_VARIABLE_NUMBER = 999;

/**
 * @description: 查询打印状态，按 templateIds 过滤打印记录并通过回调返回结果；
 *               templateIds 为空时返回最近 20 条记录
 * @param {Array<String>|*} templateIds 模板id列表，为空时查询最近 20 条
 * @param {Function} onSuccess 查询成功回调，参数为 rows
 * @param {Function} onError 查询失败回调，参数为 err
 * @return {void}
 */
function queryPrintStatus(templateIds, onSuccess, onError) {
  const baseSelect =
    "SELECT id, timestamp, socketId, clientType, printer, templateId, pageNum, status, rePrintAble, errorMessage FROM print_logs";
  const orderBy = " ORDER BY timestamp DESC, id DESC";

  // Empty templateIds → return latest 20 records
  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    db.all(`${baseSelect}${orderBy} LIMIT 20`, [], (err, rows) => {
      if (err) onError(err);
      else onSuccess(rows);
    });
    return;
  }

  // Enforce SQLite bound-parameter limit
  if (templateIds.length > SQLITE_MAX_VARIABLE_NUMBER) {
    onError(
      new Error(
        `templateIds 长度超过限制，最多支持 ${SQLITE_MAX_VARIABLE_NUMBER} 个 / templateIds exceeds limit, max ${SQLITE_MAX_VARIABLE_NUMBER}`,
      ),
    );
    return;
  }

  const placeholders = templateIds.map(() => "?").join(",");
  db.all(
    `${baseSelect} WHERE templateId IN (${placeholders})${orderBy}`,
    templateIds,
    (err, rows) => {
      if (err) onError(err);
      else onSuccess(rows);
    },
  );
}

/**
 * @description: 作为本地服务端时绑定的 socket 事件
 * @param {*} server
 * @return {void}
 */
function initServeEvent(server) {
  // 必须传入实体
  if (!server) return false;

  /**
   * @description: 校验 token
   */
  server.use((socket, next) => {
    const token = ensureAuthToken();
    const auth = socket.handshake && socket.handshake.auth;
    const providedToken = auth && auth.token;
    if (!providedToken || token !== providedToken) {
      // 不记录对端提交的 token，避免日志成为暴力破解 oracle / 泄露凭据
      console.log(`==> 插件端 Authentication error: ${socket.id}`);
      const err = new Error("Authentication error");
      err.data = {
        content: "Token 错误",
      };
      next(err);
    } else {
      next();
    }
  });

  /**
   * @description: 新的 web client 连入，绑定 socket 事件
   */
  server.on("connect", async (socket) => {
    console.log(`==> 插件端 New Connected: ${socket.id}`);

    // 通知渲染进程已连接
    sendMainWindow("serverConnection", server.engine.clientsCount);
    emitConnectionStatus();

    // 判断是否允许通知
    if (store.get("allowNotify")) {
      // 弹出连接成功通知
      const notification = new Notification({
        title: "新的连接",
        body: `已建立新的连接，当前连接数：${server.engine.clientsCount}`,
      });
      // 显示通知
      notification.show();
    }

    // 向 client 发送打印机列表
    socket.emit("printerList", await getConfiguredPrinterList());

    // 向 client 发送客户端信息
    emitClientInfo(socket);

    /**
     * @description: client 请求客户端信息
     */
    socket.on("getClientInfo", () => {
      console.log(`插件端 ${socket.id}: getClientInfo`);
      emitClientInfo(socket);
    });

    /**
     * @description: client请求 address ，获取本机 IP、IPV6、MAC 地址
     * @description: addressType 为 null 时，返回所有地址
     * @description: 逐步废弃该 api
     * @param {String} addressType ip、ipv6、mac、all === null
     */
    socket.on("address", (addressType) => {
      console.log(
        `插件端 ${socket.id}: get address(${addressType || "未指定类型"})`,
      );
      switch (addressType) {
        case "ip":
        case "ipv6":
          socket.emit("address", addressType, _address[addressType]());
          break;
        case "dns":
        case "interface":
        case "vboxnet":
          // 用处不大的几个信息，直接废弃
          socket.emit("address", addressType, null, "This type is removed.");
          break;
        default:
          addressType = addressType === "mac" ? "mac" : "all";
          _address[addressType]().then((res) => {
            socket.emit("address", addressType, res);
          });
          break;
      }
    });

    /**
     * @description: client 请求刷新打印机列表
     */
    socket.on("refreshPrinterList", async () => {
      console.log(`插件端 ${socket.id}: refreshPrinterList`);
      socket.emit("printerList", await getConfiguredPrinterList());
    });

    /**
     * @description: client 获取打印机纸张信息
     */
    socket.on("getPaperSizeInfo", (printer) => {
      console.log(`插件端 ${socket.id}: getPaperSizeInfo`);
      if (process.platform === "win32") {
        const printerName =
          typeof printer === "string"
            ? printer
            : printer && typeof printer.printer === "string"
            ? printer.printer
            : "";
        let paper = getPaperSizeInfoAll();
        if (printerName) {
          paper =
            paper.find((item) => item.PrinterName === printerName) || null;
        }
        paper && socket.emit("paperSizeInfo", paper);
      }
    });

    /**
     * @description: client 调用 ipp 打印 详见：https://www.npmjs.com/package/ipp
     */
    socket.on("ippPrint", (options) => {
      console.log(`插件端 ${socket.id}: ippPrint`);
      try {
        const { url, opt, action, message } = options;
        const targetError = getIppTargetError(url);
        if (targetError) {
          socket.emit("ippPrinterCallback", {
            type: targetError.name,
            msg: targetError.message,
          });
          return;
        }
        let printer = ipp.Printer(url, opt);
        socket.emit("ippPrinterConnected", printer);
        let msg = Object.assign(
          {
            "operation-attributes-tag": {
              "requesting-user-name": "hiPrint",
            },
          },
          message,
        );
        // data 必须是 Buffer 类型
        if (msg.data && !Buffer.isBuffer(msg.data)) {
          if ("string" === typeof msg.data) {
            msg.data = Buffer.from(msg.data, msg.encoding || "utf8");
          } else {
            msg.data = Buffer.from(msg.data);
          }
        }
        /**
         * action: Get-Printer-Attributes 获取打印机支持参数
         * action: Print-Job 新建打印任务
         * action: Cancel-Job 取消打印任务
         */
        printer.execute(action, msg, (err, res) => {
          socket.emit(
            "ippPrinterCallback",
            err ? { type: err.name, msg: err.message } : null,
            res,
          );
        });
      } catch (error) {
        console.log(`插件端 ${socket.id}: ippPrint error: ${error.message}`);
        socket.emit("ippPrinterCallback", {
          type: error.name,
          msg: error.message,
        });
      }
    });

    /**
     * @description: client ipp request 详见：https://www.npmjs.com/package/ipp
     */
    socket.on("ippRequest", (options) => {
      console.log(`插件端 ${socket.id}: ippRequest`);
      try {
        const { url, data } = options;
        const targetError = getIppTargetError(url);
        if (targetError) {
          socket.emit("ippRequestCallback", {
            type: targetError.name,
            msg: targetError.message,
          });
          return;
        }
        let _data = ipp.serialize(data);
        ipp.request(url, _data, (err, res) => {
          socket.emit(
            "ippRequestCallback",
            err ? { type: err.name, msg: err.message } : null,
            res,
          );
        });
      } catch (error) {
        console.log(`插件端 ${socket.id}: ippRequest error: ${error.message}`);
        socket.emit("ippRequestCallback", {
          type: error.name,
          msg: error.message,
        });
      }
    });

    /**
     * @description: client 常规打印任务
     */
    socket.on("news", (data) => {
      if (data) {
        PRINT_RUNNER.add((done) => {
          data.socketId = socket.id;
          data.taskId = uuidv7();
          data.clientType = "local";
          PRINT_WINDOW.webContents.send("print-new", data);
          MAIN_WINDOW.webContents.send("printTask", true);
          PRINT_RUNNER_DONE[data.taskId] = done;
        });
      }
    });

    /**
     * @description: client 分批打印任务
     */
    socket.on("printByFragments", (data) => {
      if (data) {
        const { total, index, htmlFragment, id } = data;
        const currentInfo =
          PRINT_FRAGMENTS_MAPPING[id] ||
          (PRINT_FRAGMENTS_MAPPING[id] = {
            total,
            fragments: [],
            count: 0,
            updateTime: 0,
          });
        // 添加片段信息
        currentInfo.fragments[index] = htmlFragment;
        // 计数
        currentInfo.count++;
        // 记录更新时间
        currentInfo.updateTime = Date.now();
        // 全部片段已传输完毕
        if (currentInfo.count === currentInfo.total) {
          // 清除全局缓存
          delete PRINT_FRAGMENTS_MAPPING[id];
          // 合并全部打印片段信息
          data.html = currentInfo.fragments.join("");
          // 添加打印任务
          PRINT_RUNNER.add((done) => {
            data.socketId = socket.id;
            data.taskId = uuidv7();
            data.clientType = "local";
            PRINT_WINDOW.webContents.send("print-new", data);
            MAIN_WINDOW.webContents.send("printTask", true);
            PRINT_RUNNER_DONE[data.taskId] = done;
          });
        }
        // 开始检查任务
        watchTaskInstance.startWatch();
      }
    });

    socket.on("render-print", (data) => {
      if (data) {
        RENDER_RUNNER.add((done) => {
          data.socketId = socket.id;
          data.taskId = uuidv7();
          data.clientType = "local";
          RENDER_WINDOW.webContents.send("print", data);
          RENDER_RUNNER_DONE[data.taskId] = done;
        });
      }
    });

    socket.on("render-jpeg", (data) => {
      if (data) {
        RENDER_RUNNER.add((done) => {
          data.socketId = socket.id;
          data.taskId = uuidv7();
          data.clientType = "local";
          RENDER_WINDOW.webContents.send("png", data);
          RENDER_RUNNER_DONE[data.taskId] = done;
        });
      }
    });

    socket.on("render-pdf", (data) => {
      if (data) {
        RENDER_RUNNER.add((done) => {
          data.socketId = socket.id;
          data.taskId = uuidv7();
          data.clientType = "local";
          RENDER_WINDOW.webContents.send("pdf", data);
          RENDER_RUNNER_DONE[data.taskId] = done;
        });
      }
    });

    // 本地服务端文件导出：镜像中转路径(initClientEvent)的 file.export 监听，
    // 使直连本地 Socket.IO 服务的插件端也能触发文件导出（此前仅中转路径已接线）
    socket.on("file.export", (data) => {
      console.log(`插件端 ${socket.id}: file.export`);
      handleFileExportTask(socket, data);
    });

    /**
     * @description: client 查询打印状态
     * @param {Object} data
     * @param {Array<String>} [data.templateIds] 模板id列表，为空时返回最近 20 条记录
     */
    socket.on("getPrintStatus", (data) => {
      console.log(`插件端 ${socket.id}: getPrintStatus`);
      queryPrintStatus(
        data && Array.isArray(data.templateIds) ? data.templateIds : [],
        (rows) => socket.emit("printStatus", rows),
        (err) => {
          console.error(
            `插件端 ${socket.id}: getPrintStatus error: ${err.message}`,
          );
          socket.emit("printStatusError", { msg: err.message });
        },
      );
    });

    /**
     * @description: client 断开连接
     */
    socket.on("disconnect", () => {
      console.log(`==> 插件端 Disconnect: ${socket.id}`);
      sendMainWindow("serverConnection", server.engine.clientsCount);
      emitConnectionStatus();
    });
  });
}

let transitConnectionError = "";

function getPrintBusy() {
  return !!(
    global.PRINT_RUNNER &&
    typeof global.PRINT_RUNNER.isBusy === "function" &&
    global.PRINT_RUNNER.isBusy()
  );
}

function getConnectionStatus() {
  const clientsCount =
    global.SOCKET_SERVER &&
    global.SOCKET_SERVER.engine &&
    Number(global.SOCKET_SERVER.engine.clientsCount);
  const transitConnected = !!(
    global.SOCKET_CLIENT && global.SOCKET_CLIENT.connected
  );

  return {
    localClientCount: Number.isFinite(clientsCount) ? clientsCount : 0,
    transitConnected,
    transitErrorMessage: transitConnected ? "" : transitConnectionError,
    printing: getPrintBusy(),
  };
}

function sendMainWindow(channel, payload) {
  const webContents = global.MAIN_WINDOW && global.MAIN_WINDOW.webContents;
  if (!webContents || webContents.isDestroyed()) return false;
  webContents.send(channel, payload);
  return true;
}

function emitConnectionStatus(webContents) {
  const target =
    webContents || (global.MAIN_WINDOW && global.MAIN_WINDOW.webContents);
  if (!target || target.isDestroyed()) return false;
  target.send("connectionStatus", getConnectionStatus());
  return true;
}

/**
 * @description: 作为客户端连接中转服务时绑定的 socket 事件
 * @return {void}
 */
function initClientEvent() {
  // 作为客户端连接中转服务时只有一个全局 client
  var client = global.SOCKET_CLIENT;

  /**
   * @description: 连接中转服务成功，绑定 socket 事件
   */
  client.on("connect", async () => {
    console.log(`==> 中转服务 Connected Transit Server: ${client.id}`);
    transitConnectionError = "";
    // 通知渲染进程已连接
    sendMainWindow("clientConnection", true);
    emitConnectionStatus();

    // 判断是否允许通知
    if (store.get("allowNotify")) {
      // 弹出连接成功通知
      const notification = new Notification({
        title: "已连接中转服务器",
        body: `已连接至中转服务器【${store.get("transitUrl")}】，即刻开印！`,
      });
      // 显示通知
      notification.show();
    }

    // 向 中转服务 发送打印机列表
    client.emit("printerList", await getConfiguredPrinterList());

    // 向 中转服务 发送客户端信息
    emitClientInfo(client);
  });

  /**
   * @description: 中转服务 请求客户端信息
   */
  client.on("getClientInfo", () => {
    console.log(`中转服务 ${client.id}: getClientInfo`);
    emitClientInfo(client);
  });

  /**
   * @description: 中转服务 请求刷新打印机列表
   */
  client.on("refreshPrinterList", async () => {
    console.log(`中转服务 ${client.id}: refreshPrinterList`);
    client.emit("printerList", await getConfiguredPrinterList());
  });

  /**
   * @description: 中转服务 调用 ipp 打印 详见：https://www.npmjs.com/package/ipp
   */
  client.on("ippPrint", (options) => {
    console.log(`中转服务 ${client.id}: ippPrint`);
    try {
      const { url, opt, action, message, replyId } = options;
      const targetError = getIppTargetError(url);
      if (targetError) {
        client.emit("ippPrinterCallback", {
          type: targetError.name,
          msg: targetError.message,
          replyId,
        });
        return;
      }
      let printer = ipp.Printer(url, opt);
      client.emit("ippPrinterConnected", { printer, replyId });
      let msg = Object.assign(
        {
          "operation-attributes-tag": {
            "requesting-user-name": "hiPrint",
          },
        },
        message,
      );
      // data 必须是 Buffer 类型
      if (msg.data && !Buffer.isBuffer(msg.data)) {
        if ("string" === typeof msg.data) {
          msg.data = Buffer.from(msg.data, msg.encoding || "utf8");
        } else {
          msg.data = Buffer.from(msg.data);
        }
      }
      /**
       * action: Get-Printer-Attributes 获取打印机支持参数
       * action: Print-Job 新建打印任务
       * action: Cancel-Job 取消打印任务
       */
      printer.execute(action, msg, (err, res) => {
        client.emit(
          "ippPrinterCallback",
          err ? { type: err.name, msg: err.message, replyId } : { replyId },
          res,
        );
      });
    } catch (error) {
      console.log(`中转服务 ${client.id}: ippPrint error: ${error.message}`);
      client.emit("ippPrinterCallback", {
        type: error.name,
        msg: error.message,
        replyId,
      });
    }
  });

  /**
   * @description: 中转服务 ipp request 详见：https://www.npmjs.com/package/ipp
   */
  client.on("ippRequest", (options) => {
    console.log(`中转服务 ${client.id}: ippRequest`);
    try {
      const { url, data, replyId } = options;
      const targetError = getIppTargetError(url);
      if (targetError) {
        client.emit("ippRequestCallback", {
          type: targetError.name,
          msg: targetError.message,
          replyId,
        });
        return;
      }
      let _data = ipp.serialize(data);
      ipp.request(url, _data, (err, res) => {
        client.emit(
          "ippRequestCallback",
          err ? { type: err.name, msg: err.message, replyId } : { replyId },
          res,
        );
      });
    } catch (error) {
      console.log(`中转服务 ${client.id}: ippRequest error: ${error.message}`);
      client.emit("ippRequestCallback", {
        type: error.name,
        msg: error.message,
        replyId,
      });
    }
  });

  /**
   * @description: 中转服务 常规打印任务
   */
  client.on("news", (data) => {
    if (data) {
      PRINT_RUNNER.add((done) => {
        data.socketId = client.id;
        data.taskId = uuidv7();
        data.clientType = "transit";
        PRINT_WINDOW.webContents.send("print-new", data);
        MAIN_WINDOW.webContents.send("printTask", true);
        PRINT_RUNNER_DONE[data.taskId] = done;
      });
    }
  });

  client.on("render-print", (data) => {
    if (data) {
      RENDER_RUNNER.add((done) => {
        data.socketId = client.id;
        data.taskId = uuidv7();
        data.clientType = "transit";
        RENDER_WINDOW.webContents.send("print", data);
        RENDER_RUNNER_DONE[data.taskId] = done;
      });
    }
  });

  client.on("render-jpeg", (data) => {
    if (data) {
      RENDER_RUNNER.add((done) => {
        data.socketId = client.id;
        data.taskId = uuidv7();
        data.clientType = "transit";
        RENDER_WINDOW.webContents.send("png", data);
        RENDER_RUNNER_DONE[data.taskId] = done;
      });
    }
  });

  client.on("render-pdf", (data) => {
    if (data) {
      RENDER_RUNNER.add((done) => {
        data.socketId = client.id;
        data.taskId = uuidv7();
        data.clientType = "transit";
        RENDER_WINDOW.webContents.send("pdf", data);
        RENDER_RUNNER_DONE[data.taskId] = done;
      });
    }
  });

  client.on("file.export", (data) => {
    console.log(`中转服务 ${client.id}: file.export`);
    handleFileExportTask(client, data);
  });

  /**
   * @description: 中转服务 查询打印状态
   * @param {Object} data
   * @param {Array<String>} [data.templateIds] 模板id列表，为空时返回最近 20 条记录
   */
  client.on("getPrintStatus", (data) => {
    console.log(`中转服务 ${client.id}: getPrintStatus`);
    queryPrintStatus(
      data && Array.isArray(data.templateIds) ? data.templateIds : [],
      (rows) => client.emit("printStatus", rows),
      (err) => {
        console.error(
          `中转服务 ${client.id}: getPrintStatus error: ${err.message}`,
        );
        client.emit("printStatusError", { msg: err.message });
      },
    );
  });

  /**
   * @description: 中转服务 断开连接
   */
  client.on("disconnect", (reason) => {
    console.log(`==> 中转服务 Disconnect: ${client.id}`);
    transitConnectionError = reason || "";
    sendMainWindow("clientConnection", false);
    emitConnectionStatus();
  });

  /**
   * @description: 中转服务连接失败
   */
  client.on("connect_error", (error) => {
    transitConnectionError = (error && error.message) || "连接中转服务器失败";
    console.error(`==> 中转服务 Connect Error: ${transitConnectionError}`);
    sendMainWindow("clientConnection", false);
    emitConnectionStatus();
  });
}

/**
 * @description: 打印机状态码 十进制 -> 十六进制, 返回对应的详细错误信息， 详见：https://github.com/mlmdflr/win32-pdf-printer/blob/51f7a9b3687e260a7d83ea467b22b374fb153b52/paper-size-info/Status.cs
 * @param { String } printerName  打印机名称
 * @return { Object  { StatusMsg: String // 打印机状态详情信息 } }
 */

function getCurrentPrintStatusByName(printerName) {
  if (process.platform === "win32") {
    const { StatusMsg } = getPaperSizeInfoAll().find(
      (item) => item.PrinterName === printerName,
    ) || { StatusMsg: "未找到打印机" };
    return {
      StatusMsg,
    };
  }
  return { StatusMsg: "非Windows系统, 暂不支持" };
}

function showAboutDialog() {
  const detail = `版本: ${app.getVersion()}
提交: ${buildInfo.commitId}
日期: ${buildInfo.commitDate}
Electron: ${process.versions.electron}
Chromium: ${process.versions.chrome}
Node.js: ${process.versions.node}
V8: ${process.versions.v8}
OS: ${os.type()} ${os.arch()} ${os.release()}`.trim();
  const title = store.get("mainTitle") || "Electron-hiprint";
  dialog
    .showMessageBox({
      title: `关于 ${title}`,
      message: title,
      type: "info",
      buttons: ["反馈", "复制", "确定"],
      noLink: true,
      defaultId: 0,
      detail,
      cancelId: 2,
      normalizeAccessKeys: true,
    })
    .then((result) => {
      if (result.response === 0) {
        const issuesUrl = new URL(
          `https://github.com/amDosion/electron-hiprint/issues/new`,
        );
        issuesUrl.searchParams.set(
          "title",
          `[反馈][${app.getVersion()}] 在此处完善反馈标题`,
        );
        const issuesBody = `## 问题描述
请在此处详细描述你遇到的问题

## 版本信息
  
${detail}`;
        issuesUrl.searchParams.set("body", issuesBody);
        shell.openExternal(issuesUrl.href);
      }
      if (result.response === 1) {
        clipboard.writeText(detail);
      }
    });
}

module.exports = {
  store,
  address: _address,
  initServeEvent,
  initClientEvent,
  getConnectionStatus,
  emitConnectionStatus,
  getCurrentPrintStatusByName,
  getMachineId,
  showAboutDialog,
  getHttpUrlTargetError,
  isBlockedIPv4,
  isBlockedIPv6,
};
