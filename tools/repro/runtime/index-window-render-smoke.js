"use strict";

// index 主窗口 SFC 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/index.html，附真实 src/preload/index.js（暴露 hiprintIndex 桥），
// 断言：窗口加载成功、Vue 根挂载、品牌/状态文案出现、无脚本错误。
// 不依赖主进程 IPC 应答（getMachineId 等无人应答属正常，仅令字段为空，不阻碍渲染）。
// 运行：npx electron tools/repro/runtime/index-window-render-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// preload/index.js 在加载时用 sendSync 同步取 title/version（阻塞渲染直到主进程应答）。
// harness 充当主进程，必须应答这两个同步通道，否则导航会无限挂起。
// 其余通道为异步 send（getMachineId/getAddress/notification 等），无需应答即不阻塞。
ipcMain.on("hiprint:store-get", (event, key) => {
  event.returnValue = key === "mainTitle" ? "Electron-hiprint" : undefined;
});
ipcMain.on("hiprint:app-version", (event) => {
  event.returnValue = "1.0.29";
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
      preload: path.join(REPO_ROOT, "src/preload/index.js"),
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
    await win.loadURL("app://bundle/index.html");
    result.steps.push({ step: "loaded-index-html", ok: true });

    // 给 Vue 一帧时间挂载
    await new Promise((r) => setTimeout(r, 400));

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      out.hasBridge = typeof window.hiprintIndex === 'object' && window.hiprintIndex !== null;
      const appEl = document.querySelector('#app');
      out.appChildCount = appEl ? appEl.children.length : -1;
      out.hasBox = !!document.querySelector('.box');
      out.brandText = (document.querySelector('.app-brand') || {}).textContent || '';
      out.tileCount = document.querySelectorAll('.tile').length;
      // el-icon 是否真正渲染出 svg（验证按需导入的图标生效）
      out.svgCount = document.querySelectorAll('.app-topbar svg, .hero-card svg').length;
      out.statusPillText = (document.querySelector('.status-pill') || {}).textContent || '';
      return out;
    })()`);
    result.probe = probe;

    if (probe.origin !== "app://bundle") {
      result.failed = true;
      result.steps.push({ step: "origin-mismatch", got: probe.origin });
    }
    if (!probe.hasBridge) {
      result.failed = true;
      result.steps.push({ step: "bridge-missing" });
    }
    if (!probe.hasBox || probe.appChildCount < 1) {
      result.failed = true;
      result.steps.push({
        step: "vue-not-mounted",
        childCount: probe.appChildCount,
      });
    }
    if (!/打印服务/.test(probe.brandText)) {
      result.failed = true;
      result.steps.push({ step: "brand-text-missing", got: probe.brandText });
    }
    if (probe.tileCount !== 4) {
      result.failed = true;
      result.steps.push({ step: "tile-count-wrong", got: probe.tileCount });
    }
    if (probe.svgCount < 2) {
      result.failed = true;
      result.steps.push({ step: "icons-not-rendered", got: probe.svgCount });
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
