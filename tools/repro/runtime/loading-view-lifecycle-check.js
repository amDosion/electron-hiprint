"use strict";

// 验证日志类窗口的 loading WebContentsView 会在页面加载完成后移除。
// 运行：npx electron tools/repro/runtime/loading-view-lifecycle-check.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const fs = require("fs");
const os = require("os");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const { app, BrowserWindow, ipcMain } = require("electron");

app.getAppPath = () => REPO_ROOT;
const USER_DATA_DIR = path.join(
  os.tmpdir(),
  `electron-hiprint-loading-view-${process.pid}`,
);
fs.mkdirSync(USER_DATA_DIR, { recursive: true });
app.setPath("userData", USER_DATA_DIR);
app.once("will-quit", () => {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
});

ipcMain.on("hiprint:store-get", (event, key) => {
  event.returnValue = key === "rePrint" ? 1 : undefined;
});
ipcMain.on("request-logs", (event) => {
  event.sender.send("print-logs", { rows: [], total: 0 });
});
ipcMain.on("reprint", () => {});
ipcMain.on("clear-logs", () => {});
ipcMain.handle("software-log:list-dates", () => ["2026-06-13"]);
ipcMain.handle("software-log:read", (_event, date) => ({
  file: String(date) + ".log",
  truncated: false,
  lines: [
    { ts: "2026-06-13 10:00:00", level: "info", msg: "服务已启动" },
  ],
}));
ipcMain.on("software-log:open-folder", () => {});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));
const { getAssetUrl } = require(path.join(REPO_ROOT, "src/asset-url"));
const { attachLoadingView } = require(path.join(REPO_ROOT, "src/loading-view"));

registerAssetSchemeAsPrivileged();
app.disableHardwareAcceleration();

function finish(result) {
  result.failed = Boolean(result.failed);
  console.log("SMOKE_RESULT " + JSON.stringify(result));
  app.exit(result.failed ? 1 : 0);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(check, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await wait(50);
  }
  return false;
}

async function probeWindow({ name, asset, preload }) {
  const win = new BrowserWindow({
    show: false,
    width: 1000,
    height: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload,
    },
  });

  const step = { name, events: [], consoleErrors: [] };
  win.webContents.on("dom-ready", () => step.events.push("dom-ready"));
  win.webContents.on("did-finish-load", () =>
    step.events.push("did-finish-load"),
  );
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    step.events.push(`did-fail-load:${code}:${desc}:${url}`);
  });
  win.webContents.on("console-message", (event) => {
    const details = event && typeof event === "object" ? event : {};
    const level = details.level || 0;
    const message = details.message || "";
    if (level >= 3) step.consoleErrors.push(message);
  });

  const overlay = attachLoadingView(
    win,
    { width: 1000, height: 640 },
    getAssetUrl("loading.html"),
  );

  await win.loadURL(getAssetUrl(asset));
  await wait(500);

  step.overlayDestroyed = overlay.isRemoved();
  if (!step.overlayDestroyed) {
    step.overlayDestroyed = await waitUntil(
      () => overlay.isRemoved(),
      3000,
    );
  }
  step.probe = await win.webContents.executeJavaScript(`(() => ({
    origin: location.origin,
    appChildCount: document.querySelector('#app')?.children.length ?? -1
  }))()`);

  win.destroy();
  return step;
}

const killTimer = setTimeout(() => {
  finish({ failed: true, steps: [{ step: "timeout" }] });
}, 25000);
killTimer.unref && killTimer.unref();

app.whenReady().then(async () => {
  registerAssetProtocol();

  const result = { steps: [] };
  try {
    result.steps.push(
      await probeWindow({
        name: "printLog",
        asset: "printLog.html",
        preload: path.join(REPO_ROOT, "src/preload/printLog.js"),
      }),
    );
    result.steps.push(
      await probeWindow({
        name: "softwareLog",
        asset: "softwareLog.html",
        preload: path.join(REPO_ROOT, "src/preload/softwareLog.js"),
      }),
    );

    for (const step of result.steps) {
      if (!step.overlayDestroyed) {
        result.failed = true;
        step.failure = "loading-overlay-not-removed";
      }
      if (step.probe.origin !== "app://bundle") {
        result.failed = true;
        step.failure = "origin-mismatch";
      }
      if (step.probe.appChildCount < 1) {
        result.failed = true;
        step.failure = "vue-not-mounted";
      }
      if (step.consoleErrors.length > 0) {
        result.failed = true;
        step.failure = "console-error";
      }
    }
  } catch (error) {
    result.failed = true;
    result.error = String((error && error.stack) || error);
  }

  clearTimeout(killTimer);
  finish(result);
});

app.on("window-all-closed", () => {});
