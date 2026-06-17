"use strict";

// 打印日志窗口 SFC 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/printLog.html，附真实 src/preload/printLog.js（暴露 hiprintPrintLog 桥），
// 断言：窗口加载成功、Vue 根挂载、筛选表单/表格/分页渲染、无脚本错误。
// 主进程 IPC（request-logs 等）无人应答属正常 → 表格空数据，不阻碍渲染验证。
// 运行：npx electron tools/repro/runtime/printlog-window-render-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const fs = require("fs");
const os = require("os");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;
const USER_DATA_DIR = path.join(
  os.tmpdir(),
  `electron-hiprint-printlog-smoke-${process.pid}`,
);
fs.mkdirSync(USER_DATA_DIR, { recursive: true });
app.setPath("userData", USER_DATA_DIR);
app.once("will-quit", () => {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
});

// preload/printLog.js 在加载时 sendSync 同步取 rePrint 开关（阻塞渲染直到主进程应答）。
ipcMain.on("hiprint:store-get", (event, key) => {
  event.returnValue = key === "rePrint" ? 1 : undefined;
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
    width: 1000,
    height: 640,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO_ROOT, "src/preload/printLog.js"),
    },
  });

  const result = { steps: [], consoleErrors: [] };

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    result.failed = true;
    result.steps.push({ step: "did-fail-load", code, desc, url });
  });
  win.webContents.on("console-message", (event) => {
    const details = event && typeof event === "object" ? event : {};
    const level = details.level || 0;
    const message = details.message || "";
    if (level >= 3) result.consoleErrors.push(message);
  });

  try {
    await win.loadURL("app://bundle/printLog.html");
    result.steps.push({ step: "loaded-printlog-html", ok: true });
    await new Promise((r) => setTimeout(r, 500));

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      out.hasBridge = typeof window.hiprintPrintLog === 'object' && window.hiprintPrintLog !== null;
      const appEl = document.querySelector('#app');
      out.appChildCount = appEl ? appEl.children.length : -1;
      // 打印记录已去 element-plus，改用原生 <table> + 手写分页 + 原生 <select>/datetime-local（见 App.vue 注释）。
      out.hasSearchForm = !!document.querySelector('.search-form');
      out.hasTable = !!document.querySelector('.table-wrap table.table');
      out.headerCells = document.querySelectorAll('.table-wrap table.table thead th').length;
      out.hasPagination = !!document.querySelector('.pagination');
      out.searchBtnText = (document.querySelector('.search-btns .pl-btn-primary') || {}).textContent || '';
      out.selectCount = document.querySelectorAll('.search-form select.pl-select').length;
      out.hasDatePicker = document.querySelectorAll('.search-form input[type="datetime-local"]').length >= 2;
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
    if (probe.appChildCount < 1) {
      result.failed = true;
      result.steps.push({
        step: "vue-not-mounted",
        childCount: probe.appChildCount,
      });
    }
    if (!probe.hasSearchForm || !probe.hasTable || !probe.hasPagination) {
      result.failed = true;
      result.steps.push({
        step: "core-structure-missing",
        form: probe.hasSearchForm,
        table: probe.hasTable,
        pagination: probe.hasPagination,
      });
    }
    if (probe.headerCells < 8) {
      result.failed = true;
      result.steps.push({
        step: "table-columns-wrong",
        got: probe.headerCells,
      });
    }
    if (probe.selectCount !== 2 || !probe.hasDatePicker) {
      result.failed = true;
      result.steps.push({
        step: "form-controls-wrong",
        selects: probe.selectCount,
        datePicker: probe.hasDatePicker,
      });
    }
    if (!/搜索/.test(probe.searchBtnText)) {
      result.failed = true;
      result.steps.push({
        step: "search-btn-missing",
        got: probe.searchBtnText,
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
