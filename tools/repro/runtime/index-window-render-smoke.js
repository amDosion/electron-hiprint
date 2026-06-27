"use strict";

// console 状态 route 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/console.html#/status，附真实 src/preload/console.js（暴露 hiprintIndex 桥），
// 断言：窗口加载成功、Vue 根挂载、品牌/状态文案出现、无脚本错误。
// 不依赖主进程 IPC 应答（getMachineId 等无人应答属正常，仅令字段为空，不阻碍渲染）。
// 运行：npx electron tools/repro/runtime/index-window-render-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// console preload 在加载时用 sendSync 同步取 title/version/settings（阻塞渲染直到主进程应答）。
// harness 充当主进程，必须应答这些同步通道，否则导航会无限挂起。
// 其余通道为异步 send（getMachineId/getAddress/notification 等），无需应答即不阻塞。
ipcMain.on("hiprint:store-get", (event, key) => {
  event.returnValue = key === "mainTitle" ? "Electron-hiprint" : undefined;
});
ipcMain.on("hiprint:app-version", (event) => {
  event.returnValue = "1.0.29";
});
ipcMain.on("hiprint:settings-snapshot", (event) => {
  event.returnValue = {
    port: 17521,
    token: "",
    nickName: "",
    closeType: "tray",
    pdfPath: "C:/ProgramData/hiprint/pdf",
    defaultPrinter: "",
    exportDirectory: { enabled: false },
  };
});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));

registerAssetSchemeAsPrivileged();
app.disableHardwareAcceleration();

function finish(result) {
  result.failed = Boolean(result.failed);
  console.log("SMOKE_RESULT " + JSON.stringify(result));
  app.exit(result.failed ? 1 : 0);
}

const killTimer = setTimeout(() => {
  finish({ failed: true, steps: [{ step: "timeout" }] });
}, 25000);
killTimer.unref && killTimer.unref();

app.whenReady().then(async () => {
  registerAssetProtocol();

  const win = new BrowserWindow({
    show: false,
    width: 500,
    height: 300,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO_ROOT, "src/preload/console.js"),
    },
  });

  const result = { steps: [], consoleErrors: [] };

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    result.failed = true;
    result.steps.push({ step: "did-fail-load", code, desc, url });
  });
  // 捕获渲染进程内的脚本错误（level 3 = error）
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) result.consoleErrors.push(message);
  });

  try {
    await win.loadURL("app://bundle/console.html#/status");
    result.steps.push({ step: "loaded-status-route", ok: true });

    // 给 Vue 一帧时间挂载
    await new Promise((r) => setTimeout(r, 400));

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      out.hash = location.hash;
      out.hasBridge = typeof window.hiprintIndex === 'object' && window.hiprintIndex !== null;
      const appEl = document.querySelector('#app');
      out.appChildCount = appEl ? appEl.children.length : -1;
      out.shellNavLabels = Array.from(document.querySelectorAll('.shell-nav')).map((el) => el.textContent.trim());
      out.activeShellNav = (document.querySelector('.shell-nav.active') || {}).textContent || '';
      out.statusHeading = (document.querySelector('.status-title') || document.querySelector('h1') || {}).textContent || '';
      out.cardCount = document.querySelectorAll('.status-card, .metric-card, .info-card').length;
      out.svgCount = document.querySelectorAll('svg').length;
      return out;
    })()`);
    result.probe = probe;

    if (probe.origin !== "app://bundle") {
      result.failed = true;
      result.steps.push({ step: "origin-mismatch", got: probe.origin });
    }
    if (probe.hash !== "#/status") {
      result.failed = true;
      result.steps.push({ step: "route-mismatch", got: probe.hash });
    }
    if (!probe.hasBridge) {
      result.failed = true;
      result.steps.push({ step: "bridge-missing" });
    }
    if (probe.appChildCount < 1) {
      result.failed = true;
      result.steps.push({
        step: "vue-not-mounted",
        childCount: probe.appChildCount,
      });
    }
    if (!Array.isArray(probe.shellNavLabels) || !probe.shellNavLabels.includes("连接状态")) {
      result.failed = true;
      result.steps.push({ step: "shell-nav-missing", got: probe.shellNavLabels });
    }
    if (!/连接状态/.test(probe.activeShellNav || probe.statusHeading || "")) {
      result.failed = true;
      result.steps.push({
        step: "status-route-not-active",
        active: probe.activeShellNav,
        heading: probe.statusHeading,
      });
    }
    if (result.consoleErrors.length > 0) {
      result.failed = true;
    }
  } catch (err) {
    result.failed = true;
    result.error = String((err && err.stack) || err);
  }

  clearTimeout(killTimer);
  finish(result);
});

app.on("window-all-closed", () => {});
