"use strict";
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const { getAssetUrl } = require("./asset-url");
const { attachLoadingView } = require("./loading-view");
const softwareLogStore = require("./software-log-store");

async function createSoftwareLogWindow() {
  const openedAt = Date.now();
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
  attachSoftwareLogLoadDiagnostics(SOFTWARE_LOG_WINDOW, openedAt);

  // 添加加载页面 解决白屏的问题
  attachLoadingView(
    SOFTWARE_LOG_WINDOW,
    windowOptions,
    getAssetUrl("loading.html"),
  );

  // 先注册 IPC，再加载页面；渲染端 mounted 后会立即读取 sqlite。
  initSoftwareLogEvent();

  // 监听退出，移除所有事件；必须早于 loadURL，覆盖加载期间关闭窗口的情况。
  SOFTWARE_LOG_WINDOW.on("closed", removeSoftwareLogEvent);

  // 加载软件日志页面
  try {
    await SOFTWARE_LOG_WINDOW.loadURL(getAssetUrl("softwareLog.html"));
  } catch (error) {
    console.error(`软件日志窗口：loadURL 失败 ${formatError(error)}`);
  }

  // 未打包时打开开发者工具
  if (!app.isPackaged) {
    SOFTWARE_LOG_WINDOW.webContents.openDevTools();
  }

  return SOFTWARE_LOG_WINDOW;
}

/**
 * @description: 打开 sqlite 数据库目录（软件日志存放在 software_logs 表）
 * @return {void}
 */
function openFolder() {
  shell.openPath(path.dirname(softwareLogStore.getDatabasePath()));
}

function formatError(error) {
  return error && error.message ? error.message : String(error);
}

function attachSoftwareLogLoadDiagnostics(win, openedAt) {
  const elapsed = () => Date.now() - openedAt;
  win.webContents.once("dom-ready", () => {
    console.log(`软件日志窗口：dom-ready ${elapsed()}ms`);
  });
  win.webContents.once("did-finish-load", () => {
    console.log(`软件日志窗口：did-finish-load ${elapsed()}ms`);
  });
  win.webContents.once("did-fail-load", (_event, code, description, url) => {
    console.error(
      `软件日志窗口：did-fail-load ${elapsed()}ms ${code} ${description ||
        ""} ${url || ""}`,
    );
  });
  win.webContents.once("render-process-gone", (_event, details) => {
    console.error(
      `软件日志窗口：render-process-gone ${elapsed()}ms ${details.reason}`,
    );
  });
}

/**
 * @description: 绑定软件日志窗口事件
 * @return {void}
 */
function initSoftwareLogEvent() {
  removeSoftwareLogIpcHandlers();
  ipcMain.handle("software-log:list-dates", () => softwareLogStore.listDates());
  ipcMain.handle("software-log:read", (event, date) =>
    softwareLogStore.readLog(date),
  );
  ipcMain.handle("software-log:clear", () => softwareLogStore.clearAll());
  ipcMain.on("software-log:open-folder", openFolder);
}

/**
 * @description: 移除所有事件
 * @return {void}
 */
function removeSoftwareLogEvent() {
  removeSoftwareLogIpcHandlers();
  SOFTWARE_LOG_WINDOW = null;
}

function removeSoftwareLogIpcHandlers() {
  ipcMain.removeHandler("software-log:list-dates");
  ipcMain.removeHandler("software-log:read");
  ipcMain.removeHandler("software-log:clear");
  ipcMain.removeListener("software-log:open-folder", openFolder);
}

module.exports = async () => {
  // 创建软件日志窗口
  await createSoftwareLogWindow();
};
