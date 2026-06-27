"use strict";
const { app, BrowserWindow } = require("electron");
const path = require("path");
const { getAssetUrl } = require("./asset-url");
const { attachLoadingView } = require("./loading-view");

let appWindow = null;
let reallyClose = false;

function buildWindow() {
  const windowOptions = {
    width: 1080,
    height: 640,
    minWidth: 1040,
    minHeight: 560,
    show: false,
    title: "hiPrint 控制台",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // 预热建窗时 show:false，窗口在用户点击托盘前长期隐藏。默认 backgroundThrottling=true 会让
      // 隐藏渲染进程被降优先级/节流，入口脚本的解析执行被严重拖慢，dom-ready 迟迟不触发。
      // 关掉节流，让隐藏期也能正常完成首屏加载（配合入口按需瘦身，托盘打开近乎即时）。
      backgroundThrottling: false,
      preload: path.join(__dirname, "preload/console.js"),
    },
  };
  const win = new BrowserWindow(windowOptions);
  attachConsoleDiagnostics(win, Date.now());
  attachLoadingView(win, windowOptions, getAssetUrl("loading.html"));
  // 关闭 = 隐藏复用；仅 destroyConsole() 置标志后真正销毁
  win.on("close", (event) => {
    if (!reallyClose) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    appWindow = null;
  });
  win
    .loadURL(getAssetUrl("console.html"))
    .catch((e) =>
      console.error(
        `控制台窗口：loadURL 失败 ${e && e.message ? e.message : e}`,
      ),
    );
  if (!app.isPackaged) win.webContents.openDevTools();
  return win;
}

function ensureWindow() {
  if (!appWindow || appWindow.isDestroyed()) appWindow = buildWindow();
  return appWindow;
}

async function prewarmConsole() {
  ensureWindow();
}

async function showConsole(route) {
  const win = ensureWindow();
  if (!win.isVisible()) win.show();
  win.focus();
  const target = route || "/status";
  // 渲染端就绪后再发导航，避免早于 router 挂载
  if (win.webContents.isLoading()) {
    win.webContents.once("did-finish-load", () =>
      win.webContents.send("console:navigate", target),
    );
  } else {
    win.webContents.send("console:navigate", target);
  }
}

function destroyConsole() {
  reallyClose = true;
  if (appWindow && !appWindow.isDestroyed()) appWindow.destroy();
  appWindow = null;
}

function getAppWindow() {
  return appWindow;
}

function attachConsoleDiagnostics(win, openedAt) {
  const elapsed = () => Date.now() - openedAt;
  win.webContents.once("dom-ready", () =>
    console.log(`控制台窗口：dom-ready ${elapsed()}ms`),
  );
  win.webContents.once("did-finish-load", () =>
    console.log(`控制台窗口：did-finish-load ${elapsed()}ms`),
  );
  win.webContents.once("did-fail-load", (_e, code, desc, url) =>
    console.error(
      `控制台窗口：did-fail-load ${elapsed()}ms ${code} ${desc || ""} ${url ||
        ""}`,
    ),
  );
  win.webContents.once("render-process-gone", (_e, d) =>
    console.error(`控制台窗口：render-process-gone ${elapsed()}ms ${d.reason}`),
  );
}

module.exports = { getAppWindow, showConsole, prewarmConsole, destroyConsole };
