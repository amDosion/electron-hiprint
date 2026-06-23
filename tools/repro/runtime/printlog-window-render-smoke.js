"use strict";

// 打印日志窗口 SFC 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/console.html#/print-log，附真实 src/preload/console.js（暴露 hiprintPrintLog 桥），
// 断言：窗口加载成功、Vue 根挂载、筛选表单/表格/分页渲染、无脚本错误。
// 主进程 IPC 使用最小 stub，避免 console preload 同步读取标题/版本/设置快照时阻塞。
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

// console.js preload 在加载时 sendSync 同步取主标题、版本、设置快照与 rePrint 开关。
ipcMain.on("hiprint:store-get", (event, key) => {
  if (key === "mainTitle") event.returnValue = "Electron-hiprint";
  else if (key === "rePrint") event.returnValue = 1;
  else event.returnValue = undefined;
});
ipcMain.on("hiprint:app-version", (event) => {
  event.returnValue = "0.0.0-repro";
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
  event.sender.send("print-logs", { rows: [], total: 0 });
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
      preload: path.join(REPO_ROOT, "src/preload/console.js"),
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
    await win.loadURL("app://bundle/console.html#/print-log");
    result.steps.push({ step: "loaded-printlog-route", ok: true });
    await new Promise((r) => setTimeout(r, 700));

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      out.hash = location.hash;
      out.hasBridge = typeof window.hiprintPrintLog === 'object' && window.hiprintPrintLog !== null;
      const appEl = document.querySelector('#app');
      out.appChildCount = appEl ? appEl.children.length : -1;
      // 打印记录已去 element-plus，改用原生 <table> + 手写分页 + 原生 <select>/datetime-local（见 App.vue 注释）。
      out.hasSearchForm = !!document.querySelector('.search-form');
      out.hasTable = !!document.querySelector('.table-wrap table.table');
      out.headerCells = document.querySelectorAll('.table-wrap table.table thead th').length;
      out.hasPagination = !!document.querySelector('.pagination');
      const searchBtn = document.querySelector('.search-btns .pl-btn-primary');
      out.searchBtnText = (searchBtn || {}).textContent || '';
      if (searchBtn) {
        const style = getComputedStyle(searchBtn);
        out.searchBtnStyle = {
          color: style.color,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
        };
      } else {
        out.searchBtnStyle = null;
      }
      out.selectCount = document.querySelectorAll('.search-form select.pl-select').length;
      out.dateInputCount = document.querySelectorAll('.search-form input[type="datetime-local"]').length;
      out.hasDatePicker = out.dateInputCount >= 2;
      out.timeLabels = Array.from(document.querySelectorAll('.filter-time .time-placeholder')).map((el) => el.textContent.trim());
      out.timeSeparatorText = (document.querySelector('.filter-time .dt-sep') || {}).textContent || '';
      out.emptyDateInputsHideNativePlaceholder = Array.from(document.querySelectorAll('.filter-time input[type="datetime-local"]')).every((input) => {
        const style = getComputedStyle(input);
        return input.classList.contains('is-empty') && style.color === 'rgba(0, 0, 0, 0)';
      });
      return out;
    })()`);
    result.probe = probe;

    if (process.env.HIPRINT_CAPTURE_PRINTLOG_OUT) {
      const capturePath = path.resolve(REPO_ROOT, process.env.HIPRINT_CAPTURE_PRINTLOG_OUT);
      fs.mkdirSync(path.dirname(capturePath), { recursive: true });
      const image = await win.capturePage();
      fs.writeFileSync(capturePath, image.toPNG());
      result.capturePath = capturePath;
    }

    if (probe.origin !== "app://bundle") {
      result.failed = true;
      result.steps.push({ step: "origin-mismatch", got: probe.origin });
    }
    if (probe.hash !== "#/print-log") {
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
    if (
      JSON.stringify(probe.timeLabels) !== JSON.stringify(["开始时间", "结束时间"]) ||
      String(probe.timeSeparatorText).trim() !== "-" ||
      probe.emptyDateInputsHideNativePlaceholder !== true
    ) {
      result.failed = true;
      result.steps.push({
        step: "time-range-labels-wrong",
        labels: probe.timeLabels,
        separator: probe.timeSeparatorText,
        hideNativePlaceholder: probe.emptyDateInputsHideNativePlaceholder,
      });
    }
    if (
      !probe.searchBtnStyle ||
      (probe.searchBtnStyle.backgroundImage === "none" &&
        /rgba?\(255,\s*255,\s*255|rgba?\(0,\s*0,\s*0,\s*0\)/.test(probe.searchBtnStyle.backgroundColor))
    ) {
      result.failed = true;
      result.steps.push({
        step: "search-btn-background-invisible",
        style: probe.searchBtnStyle,
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
