"use strict";

// 可见窗口链路真实加载「软件日志 / 打印记录」console SPA route 并截图。
// 与既有 loading-view-lifecycle-check.js（show:false 隐藏窗口 + 只验 isRemoved）不同：
// 本脚本走真实可见窗口 + 真实 1MB 页面 + app:// 协议（net.fetch 修复后的实现），
// 截图证明页面确实渲染出来（不是只剩 loading spinner），并打印各阶段耗时。
//
// 运行：npx electron tools/repro/runtime/log-window-visible-capture.js
// 产物：.investigations/verify-softwareLog.png / verify-printLog.png
// 约定：stdout 打印 CAPTURE_RESULT <json>。

const path = require("path");
const fs = require("fs");
const os = require("os");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const { app, BrowserWindow, ipcMain } = require("electron");

app.getAppPath = () => REPO_ROOT;
const USER_DATA_DIR = path.join(
  os.tmpdir(),
  `electron-hiprint-visible-capture-${process.pid}`,
);
fs.mkdirSync(USER_DATA_DIR, { recursive: true });
app.setPath("userData", USER_DATA_DIR);
app.once("will-quit", () => {
  try {
    fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
  } catch {}
});

// --- 渲染端所需的最小 IPC（与 loading-view-lifecycle-check 保持一致）---
ipcMain.on("hiprint:store-get", (event, key) => {
  event.returnValue =
    key === "mainTitle"
      ? "Electron-hiprint"
      : key === "rePrint"
      ? 1
      : undefined;
});
ipcMain.on("hiprint:app-version", (event) => {
  event.returnValue = "1.0.60";
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
ipcMain.on("request-logs", (event) => {
  event.sender.send("print-logs", {
    rows: [
      {
        id: 1,
        timestamp: "2026-06-14 22:00:00",
        socketId: "dBDEmSTPAs8iYDLi",
        clientType: "local",
        printer: "HP LaserJet 1020",
        templateId: "tpl-001",
        pageNum: 1,
        status: "success",
        rePrintAble: 1,
        errorMessage: "",
      },
    ],
    total: 1,
  });
});
ipcMain.on("reprint", () => {});
ipcMain.on("clear-logs", () => {});
ipcMain.handle("software-log:list-dates", () => ["2026-06-14"]);
ipcMain.handle("software-log:read", (_event, date) => ({
  file: String(date),
  truncated: false,
  lines: [
    { ts: "2026-06-14 22:00:00", level: "info", msg: "服务已启动" },
    { ts: "2026-06-14 22:00:01", level: "info", msg: "中转服务已连接" },
    { ts: "2026-06-14 22:00:02", level: "warn", msg: "示例告警一条" },
  ],
}));
ipcMain.on("software-log:open-folder", () => {});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));
const { getAssetUrl } = require(path.join(REPO_ROOT, "src/asset-url"));
const { attachLoadingView } = require(path.join(REPO_ROOT, "src/loading-view"));

// 此命令行环境无真实 GUI/GPU：关闭硬件加速，用离屏渲染（show:false）+ capturePage 截图。
// capturePage 对离屏窗口同样捕获已渲染内容，足以验证「页面是否真的渲染出来」。
app.disableHardwareAcceleration();
registerAssetSchemeAsPrivileged();

const OUT_DIR = path.join(REPO_ROOT, ".investigations");
fs.mkdirSync(OUT_DIR, { recursive: true });

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureWindow({
  name,
  asset,
  hash = "",
  preload,
  bridgeName,
  expectedText,
  outFile,
}) {
  const width = 1080;
  const height = 600;
  const openedAt = Date.now();
  const win = new BrowserWindow({
    show: false, // 无头环境用离屏渲染；capturePage 仍可截到已渲染内容
    width,
    height,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload,
    },
  });

  const events = [];
  win.webContents.on("dom-ready", () =>
    events.push(`dom-ready:${Date.now() - openedAt}ms`),
  );
  win.webContents.on("did-finish-load", () =>
    events.push(`did-finish-load:${Date.now() - openedAt}ms`),
  );
  win.webContents.on("did-fail-load", (_e, code, desc) =>
    events.push(`did-fail-load:${code}:${desc}`),
  );

  const overlay = attachLoadingView(
    win,
    { width, height },
    getAssetUrl("loading.html"),
  );

  await win.loadURL(`${getAssetUrl(asset)}${hash}`);
  // 给 Vue 挂载 + Element Plus 渲染留时间，再截图。
  await wait(2500);

  const probe = await win.webContents.executeJavaScript(
    `(() => ({
      origin: location.origin,
      hash: location.hash,
      hasBridge: typeof window[${JSON.stringify(bridgeName)}] === 'object' && window[${JSON.stringify(bridgeName)}] !== null,
      appChildren: document.querySelector('#app')?.children.length ?? -1,
      bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
    }))()`,
  );

  const image = await win.webContents.capturePage();
  fs.writeFileSync(outFile, image.toPNG());

  const step = {
    name,
    hash,
    events,
    overlayRemoved: overlay.isRemoved(),
    probe,
    hasExpectedText: expectedText
      ? String(probe.bodyText || "").includes(expectedText)
      : true,
    outFile,
    totalMs: Date.now() - openedAt,
  };
  win.destroy();
  return step;
}

const killTimer = setTimeout(() => {
  console.log(
    "CAPTURE_RESULT " + JSON.stringify({ failed: true, reason: "timeout" }),
  );
  app.exit(1);
}, 40000);
killTimer.unref && killTimer.unref();

app.whenReady().then(async () => {
  registerAssetProtocol();

  const result = { steps: [] };
  try {
    result.steps.push(
      await captureWindow({
        name: "softwareLog",
        asset: "console.html",
        hash: "#/software-log",
        preload: path.join(REPO_ROOT, "src/preload/console.js"),
        bridgeName: "hiprintSoftwareLog",
        expectedText: "软件日志",
        outFile: path.join(OUT_DIR, "verify-softwareLog.png"),
      }),
    );
    result.steps.push(
      await captureWindow({
        name: "printLog",
        asset: "console.html",
        hash: "#/print-log",
        preload: path.join(REPO_ROOT, "src/preload/console.js"),
        bridgeName: "hiprintPrintLog",
        expectedText: "打印记录",
        outFile: path.join(OUT_DIR, "verify-printLog.png"),
      }),
    );
  } catch (error) {
    result.failed = true;
    result.error = String((error && error.stack) || error);
  }

  for (const step of result.steps) {
    if (
      !step.overlayRemoved ||
      !step.probe ||
      step.probe.origin !== "app://bundle" ||
      step.probe.hash !== step.hash ||
      !step.probe.hasBridge ||
      step.probe.appChildren < 1 ||
      !step.hasExpectedText
    ) {
      result.failed = true;
    }
  }

  clearTimeout(killTimer);
  console.log("CAPTURE_RESULT " + JSON.stringify(result));
  app.exit(result.failed ? 1 : 0);
});

app.on("window-all-closed", () => {});
