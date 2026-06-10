"use strict";
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  shell,
} = require("electron");
const path = require("path");
const { store } = require("../tools/utils");
const { getAssetUrl } = require("./asset-url");
const softwareLogStore = require("./software-log-store");

// 软件日志目录：与 main.js 同口径（store.logPath 优先，否则系统 logs 目录）。
// 软件日志数据已迁移到 sqlite（software_logs 表，见 software-log-store.js）；
// 此处仅用于「打开日志文件夹」——该目录仍保留 electron-log 文本兜底文件。
const logPath = store.get("logPath") || app.getPath("logs");

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
 * @description: 打开日志文件夹（electron-log 文本兜底文件仍写在此目录）
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
  ipcMain.handle("software-log:list-dates", () => softwareLogStore.listDates());
  ipcMain.handle("software-log:read", (event, date) =>
    softwareLogStore.readLog(date),
  );
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
