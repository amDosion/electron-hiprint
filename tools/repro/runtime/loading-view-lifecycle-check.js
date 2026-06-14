"use strict";

// 验证所有 app:// 窗口的 loading WebContentsView 会在页面加载完成后移除。
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
  event.returnValue =
    key === "mainTitle" ? "Electron-hiprint" : key === "rePrint" ? 1 : undefined;
});
ipcMain.on("hiprint:app-version", (event) => {
  event.returnValue = "1.0.54";
});
ipcMain.on("hiprint:settings-snapshot", (event) => {
  event.returnValue = {
    port: 17521,
    token: "",
    nickName: "",
    openAtLogin: false,
    openAsHidden: false,
    connectTransit: false,
    transitUrl: "",
    transitToken: "",
    allowNotify: false,
    closeType: "tray",
    pdfPath: "C:/ProgramData/hiprint/pdf",
    defaultPrinter: "",
    exportDirectory: { enabled: false },
  };
});
ipcMain.on("setContentSize", () => {});
ipcMain.on("request-logs", (event) => {
  event.sender.send("print-logs", { rows: [], total: 0 });
});
ipcMain.on("reprint", () => {});
ipcMain.on("clear-logs", () => {});
ipcMain.handle("software-log:list-dates", () => ["2026-06-13"]);
ipcMain.handle("software-log:read", (_event, date) => ({
  file: String(date),
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

async function probeWindow({
  name,
  asset,
  preload,
  width = 1000,
  height = 640,
  bridgeName,
}) {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
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
  win.webContents.on("console-message", (...args) => {
    const maybeDetails = args[0] && typeof args[0] === "object" ? args[0] : {};
    const level = Number.isInteger(maybeDetails.level)
      ? maybeDetails.level
      : args[1] || 0;
    const message = maybeDetails.message || args[2] || "";
    if (level >= 3) step.consoleErrors.push(message);
  });

  const overlay = attachLoadingView(
    win,
    { width, height },
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
  step.probe = await win.webContents.executeJavaScript(`(() => {
    const bridgeName = ${JSON.stringify(bridgeName || "")};
    return {
      origin: location.origin,
      appChildCount: document.querySelector('#app')?.children.length ?? -1,
      hasBridge: bridgeName ? typeof window[bridgeName] === 'object' && window[bridgeName] !== null : true
    };
  })()`);

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
        name: "index",
        asset: "index.html",
        preload: path.join(REPO_ROOT, "src/preload/index.js"),
        width: 500,
        height: 300,
        bridgeName: "hiprintIndex",
      }),
    );
    result.steps.push(
      await probeWindow({
        name: "set",
        asset: "set.html",
        preload: path.join(REPO_ROOT, "src/preload/set.js"),
        width: 520,
        height: 720,
        bridgeName: "hiprintSet",
      }),
    );
    result.steps.push(
      await probeWindow({
        name: "printLog",
        asset: "printLog.html",
        preload: path.join(REPO_ROOT, "src/preload/printLog.js"),
        bridgeName: "hiprintPrintLog",
      }),
    );
    result.steps.push(
      await probeWindow({
        name: "softwareLog",
        asset: "softwareLog.html",
        preload: path.join(REPO_ROOT, "src/preload/softwareLog.js"),
        bridgeName: "hiprintSoftwareLog",
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
      if (!step.probe.hasBridge) {
        result.failed = true;
        step.failure = "bridge-missing";
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
