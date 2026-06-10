"use strict";
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
} = require("electron");
const fs = require("fs");
const path = require("path");
const { store } = require("../tools/utils");
const { getAssetUrl } = require("./asset-url");

// 软件日志目录：与 main.js 同口径（store.logPath 优先，否则系统 logs 目录）
const logPath = store.get("logPath") || app.getPath("logs");

// 单个日期文件最多读取的行数与字节数上限，避免超大日志一次性读入内存。
const MAX_LINES = 2000;
const MAX_BYTES = 1024 * 1024; // 1MB

// 日期文件名 / 日期参数的严格格式：YYYY-MM-DD
const DATE_FILE_RE = /^\d{4}-\d{2}-\d{2}\.log$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// electron-log 默认格式：[YYYY-MM-DD HH:mm:ss.SSS] [level] 正文
const LOG_LINE_RE = /^\[([^\]]+)\]\s+\[([a-zA-Z]+)\]\s?(.*)$/;

const KNOWN_LEVELS = new Set([
  "error",
  "warn",
  "info",
  "verbose",
  "debug",
  "silly",
]);

function createSoftwareLogWindow() {
  const windowOptions = {
    width: 1080,
    height: 600,
    minWidth: 1040,
    minHeight: 550,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload/softwareLog.js"),
    },
  };

  // 创建软件日志窗口
  SOFTWARE_LOG_WINDOW = new BrowserWindow(windowOptions);

  // 添加加载页面 解决白屏的问题
  loadingView(windowOptions);

  // 加载软件日志页面
  SOFTWARE_LOG_WINDOW.loadURL(getAssetUrl("softwareLog.html"));

  // 未打包时打开开发者工具
  if (!app.isPackaged) {
    SOFTWARE_LOG_WINDOW.webContents.openDevTools();
  }

  // 绑定窗口事件
  initSoftwareLogEvent();

  // 监听退出，移除所有事件
  SOFTWARE_LOG_WINDOW.on("closed", removeSoftwareLogEvent);

  return SOFTWARE_LOG_WINDOW;
}

/**
 * @description: 加载等待页面，解决主窗口白屏问题
 * @param {Object} windowOptions 主窗口配置
 * @return {void}
 */
function loadingView(windowOptions) {
  const loadingContentView = new WebContentsView();
  SOFTWARE_LOG_WINDOW.contentView.addChildView(loadingContentView);
  loadingContentView.setBounds({
    x: 0,
    y: 0,
    width: windowOptions.width,
    height: windowOptions.height,
  });

  loadingContentView.webContents.loadURL(getAssetUrl("loading.html"));

  const removeLoadingView = () => {
    if (
      loadingContentView.webContents &&
      !loadingContentView.webContents.isDestroyed()
    ) {
      loadingContentView.webContents.destroy();
    }
    SOFTWARE_LOG_WINDOW.contentView.removeChildView(loadingContentView);
  };

  // dom 加载完毕移除加载视图；加载失败也清理，避免 WebContents 泄漏
  SOFTWARE_LOG_WINDOW.webContents.on("dom-ready", removeLoadingView);
  SOFTWARE_LOG_WINDOW.webContents.on("did-fail-load", removeLoadingView);
}

/**
 * @description: 列出可用的日志日期（去掉 .log 后缀），按降序排列
 * @return {Promise<string[]>}
 */
function listDates() {
  try {
    const files = fs.readdirSync(logPath);
    return files
      .filter((name) => DATE_FILE_RE.test(name))
      .map((name) => name.slice(0, -4)) // 去掉 ".log"
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)); // 降序
  } catch (error) {
    // 目录不存在 / 读失败：返回空数组，不抛异常
    return [];
  }
}

/**
 * @description: 解析单行日志为 { ts, level, msg }
 *   按 electron-log 默认格式 [时间] [级别] 正文 尽力解析；解析不出的整行作为 raw、级别记为 info。
 * @param {string} line
 * @return {{ts: string, level: string, msg: string}}
 */
function parseLine(line) {
  const match = LOG_LINE_RE.exec(line);
  if (match) {
    const ts = match[1];
    const rawLevel = String(match[2] || "").toLowerCase();
    const level = KNOWN_LEVELS.has(rawLevel) ? rawLevel : "info";
    return { ts, level, msg: match[3] != null ? match[3] : "" };
  }
  // 解析不出：整行作为正文，级别记为 info
  return { ts: "", level: "info", msg: line };
}

/**
 * @description: 读取某一天的日志（带目录穿越防护与大小上限）
 * @param {string} date 形如 YYYY-MM-DD
 * @return {{lines: Array, file: string|null, truncated: boolean}}
 */
function readLog(date) {
  const empty = { lines: [], file: null, truncated: false };

  try {
    // 【安全】严格校验日期格式，拒绝任意字符串
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return empty;
    }

    const targetPath = path.join(logPath, date + ".log");

    // 【安全】防目录穿越：解析后的目标路径必须仍位于 logPath 之下
    const resolvedTarget = path.resolve(targetPath);
    const resolvedBase = path.resolve(logPath);
    const baseWithSep = resolvedBase.endsWith(path.sep)
      ? resolvedBase
      : resolvedBase + path.sep;
    if (!resolvedTarget.startsWith(baseWithSep)) {
      return empty;
    }

    let content;
    let truncated = false;

    // 文件不存在 / 读失败由外层 catch 兜底
    const stat = fs.statSync(resolvedTarget);
    if (!stat.isFile()) {
      return empty;
    }

    if (stat.size > MAX_BYTES) {
      // 仅读取文件末尾 MAX_BYTES 字节
      const fd = fs.openSync(resolvedTarget, "r");
      try {
        const buffer = Buffer.alloc(MAX_BYTES);
        fs.readSync(fd, buffer, 0, MAX_BYTES, stat.size - MAX_BYTES);
        content = buffer.toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
      // 末尾截断可能切断首行，丢弃可能不完整的第一行
      const firstNewline = content.indexOf("\n");
      if (firstNewline >= 0) {
        content = content.slice(firstNewline + 1);
      }
      truncated = true;
    } else {
      content = fs.readFileSync(resolvedTarget, "utf8");
    }

    let rawLines = content.split(/\r?\n/);
    // 去掉末尾空行
    while (rawLines.length && rawLines[rawLines.length - 1] === "") {
      rawLines.pop();
    }

    // 行数上限：仅保留末尾 MAX_LINES 行
    if (rawLines.length > MAX_LINES) {
      rawLines = rawLines.slice(rawLines.length - MAX_LINES);
      truncated = true;
    }

    const lines = rawLines.map(parseLine);

    return { lines, file: date + ".log", truncated };
  } catch (error) {
    // 任何异常返回安全空结果，不抛未捕获异常
    return empty;
  }
}

/**
 * @description: 打开日志文件夹
 * @return {void}
 */
function openFolder() {
  shell.openPath(logPath);
}

/**
 * @description: 绑定软件日志窗口事件
 * @return {void}
 */
function initSoftwareLogEvent() {
  ipcMain.handle("software-log:list-dates", () => listDates());
  ipcMain.handle("software-log:read", (event, date) => readLog(date));
  ipcMain.on("software-log:open-folder", openFolder);
}

/**
 * @description: 移除所有事件
 * @return {void}
 */
function removeSoftwareLogEvent() {
  ipcMain.removeHandler("software-log:list-dates");
  ipcMain.removeHandler("software-log:read");
  ipcMain.removeListener("software-log:open-folder", openFolder);
  SOFTWARE_LOG_WINDOW = null;
}

module.exports = async () => {
  // 创建软件日志窗口
  await createSoftwareLogWindow();
};
