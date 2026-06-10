"use strict";

// 软件日志窗口 SFC 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/softwareLog.html，附真实 src/preload/softwareLog.js（暴露 hiprintSoftwareLog 桥）。
// 断言：加载成功、origin 为 app://bundle、桥注入、Vue 根挂载、顶栏品牌/日期选择/级别选择/搜索框、
//       console 渲染出日志行与级别标签、刷新/打开文件夹按钮、无脚本错误。
// preload 用 ipcRenderer.invoke（异步）取日期/读日志，故 harness 用 ipcMain.handle 应答以驱动真实挂载。
// 运行：npx electron tools/repro/runtime/softwarelog-window-render-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// 软件日志桥经 invoke 取数据：列出日期 + 读取某日日志。给出可断言的真实负载。
ipcMain.handle("software-log:list-dates", () => ["2026-06-10", "2026-06-09"]);
ipcMain.handle("software-log:read", (_event, date) => ({
  file: String(date) + ".log",
  truncated: false,
  lines: [
    { ts: "2026-06-10 10:00:00", level: "info", msg: "服务已启动" },
    { ts: "2026-06-10 10:00:01", level: "warn", msg: "端口占用，重试中" },
    { ts: "2026-06-10 10:00:02", level: "error", msg: "连接失败" },
  ],
}));
ipcMain.on("software-log:open-folder", () => {});

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
    width: 920,
    height: 620,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO_ROOT, "src/preload/softwareLog.js"),
    },
  });

  const result = { steps: [], consoleErrors: [] };

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    result.failed = true;
    result.steps.push({ step: "did-fail-load", code, desc, url });
  });
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) result.consoleErrors.push(message);
  });

  try {
    await win.loadURL("app://bundle/softwareLog.html");
    result.steps.push({ step: "loaded-softwarelog-html", ok: true });
    // 等待 onMounted 的 invoke（list-dates → read）解析 + nextTick 渲染
    await new Promise((r) => setTimeout(r, 800));

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      out.hasBridge = typeof window.hiprintSoftwareLog === 'object' && window.hiprintSoftwareLog !== null;
      const appEl = document.querySelector('#app');
      out.appChildCount = appEl ? appEl.children.length : -1;
      out.hasTopbar = !!document.querySelector('.topbar');
      out.brandText = (document.querySelector('.brand') || {}).textContent || '';
      out.selectCount = document.querySelectorAll('.topbar .el-select').length;
      out.hasSearch = !!document.querySelector('.topbar .el-input');
      out.hasConsole = !!document.querySelector('.console');
      out.hasFooter = !!document.querySelector('.footer');
      out.iconBtnCount = document.querySelectorAll('.sl-icon-btn').length;
      out.logRowCount = document.querySelectorAll('.console .log-row').length;
      out.levelLabelCount = document.querySelectorAll('.console .log-level').length;
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
    if (
      probe.appChildCount < 1 ||
      !probe.hasTopbar ||
      !probe.hasConsole ||
      !probe.hasFooter
    ) {
      result.failed = true;
      result.steps.push({
        step: "vue-not-mounted",
        childCount: probe.appChildCount,
        topbar: probe.hasTopbar,
        console: probe.hasConsole,
        footer: probe.hasFooter,
      });
    }
    if (!/软件日志/.test(probe.brandText || "")) {
      result.failed = true;
      result.steps.push({ step: "brand-missing", got: probe.brandText });
    }
    if (probe.selectCount !== 2) {
      result.failed = true;
      result.steps.push({ step: "select-count-wrong", got: probe.selectCount });
    }
    if (!probe.hasSearch) {
      result.failed = true;
      result.steps.push({ step: "search-input-missing" });
    }
    if (probe.iconBtnCount !== 2) {
      result.failed = true;
      result.steps.push({
        step: "icon-buttons-wrong",
        got: probe.iconBtnCount,
      });
    }
    // 3 条注入日志应渲染为 3 行 + 3 个级别标签
    if (probe.logRowCount !== 3 || probe.levelLabelCount !== 3) {
      result.failed = true;
      result.steps.push({
        step: "log-rows-wrong",
        rows: probe.logRowCount,
        levels: probe.levelLabelCount,
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
