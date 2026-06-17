"use strict";

// 软件日志窗口 SFC 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/softwareLog.html，附真实 src/preload/softwareLog.js（暴露 hiprintSoftwareLog 桥）。
// 断言：加载成功、origin 为 app://bundle、桥注入、Vue 根挂载、顶栏品牌/日期选择/级别选择/搜索框、
//       console 渲染出日志行与级别标签、刷新/打开数据库目录按钮、sqlite 页脚来源、
//       长异常日志不会撑出横向滚动条、底栏可见、无脚本错误。
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
  file: String(date),
  truncated: false,
  lines: [
    { ts: "2026-06-10 10:00:00", level: "info", msg: "服务已启动" },
    { ts: "2026-06-10 10:00:01", level: "warn", msg: "端口占用，重试中" },
    { ts: "2026-06-10 10:00:02", level: "error", msg: "连接失败" },
    {
      ts: "2026-06-10 10:00:03",
      level: "error",
      msg:
        "Error: " +
        "LONG_STACK_TOKEN_WITHOUT_SPACES_".repeat(18) +
        " at src/pdf-print.js:88:13",
    },
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
      // 软件日志已去 element-plus，改用原生 <select> + 搜索框（见 App.vue 注释）。
      out.selectCount = document.querySelectorAll('.topbar select.sl-ctrl').length;
      out.hasSearch = !!document.querySelector('.topbar .sl-search input');
      out.hasConsole = !!document.querySelector('.console');
      out.hasFooter = !!document.querySelector('.footer');
      out.iconBtnCount = document.querySelectorAll('.sl-icon-btn').length;
      out.iconTitles = Array.from(document.querySelectorAll('.sl-icon-btn')).map((button) => button.getAttribute('title') || '');
      out.footerText = (document.querySelector('.footer') || {}).textContent || '';
      out.logRowCount = document.querySelectorAll('.console .log-row').length;
      out.levelLabelCount = document.querySelectorAll('.console .log-level').length;
      const topbar = document.querySelector('.topbar');
      const consoleEl = document.querySelector('.console');
      const footer = document.querySelector('.footer');
      const footerRect = footer ? footer.getBoundingClientRect() : null;
      const rows = Array.from(document.querySelectorAll('.console .log-row'));
      out.geom = {
        winW: window.innerWidth,
        winH: window.innerHeight,
        docHorizontalScrollable: document.documentElement.scrollWidth > window.innerWidth + 1,
        docVerticalScrollable: document.documentElement.scrollHeight > window.innerHeight + 1,
        topbarHorizontalScrollable: topbar ? topbar.scrollWidth > topbar.clientWidth + 1 : true,
        consoleHorizontalScrollable: consoleEl ? consoleEl.scrollWidth > consoleEl.clientWidth + 1 : true,
        consoleVerticalScrollable: consoleEl ? consoleEl.scrollHeight > consoleEl.clientHeight + 1 : false,
        footerVisible: footerRect ? footerRect.bottom <= window.innerHeight + 1 && footerRect.top >= 0 : false,
        rowsFit: rows.every((row) => row.scrollWidth <= row.clientWidth + 1),
      };
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
    if (
      !Array.isArray(probe.iconTitles) ||
      !probe.iconTitles.includes("打开数据库目录")
    ) {
      result.failed = true;
      result.steps.push({
        step: "database-folder-button-missing",
        got: probe.iconTitles,
      });
    }
    if (!/sqlite\/software_logs/.test(probe.footerText || "")) {
      result.failed = true;
      result.steps.push({
        step: "sqlite-footer-missing",
        got: probe.footerText,
      });
    }
    if (/\.log|…\/logs\//.test(probe.footerText || "")) {
      result.failed = true;
      result.steps.push({
        step: "file-log-footer-present",
        got: probe.footerText,
      });
    }
    // 4 条注入日志应渲染为 4 行 + 4 个级别标签，其中最后一条是无空格长异常文本。
    if (probe.logRowCount !== 4 || probe.levelLabelCount !== 4) {
      result.failed = true;
      result.steps.push({
        step: "log-rows-wrong",
        rows: probe.logRowCount,
        levels: probe.levelLabelCount,
      });
    }
    const geom = probe.geom || {};
    const layoutChecks = {
      "window-not-horizontally-scrollable":
        geom.docHorizontalScrollable === false,
      "window-not-vertically-scrollable": geom.docVerticalScrollable === false,
      "topbar-not-horizontally-scrollable":
        geom.topbarHorizontalScrollable === false,
      "console-not-horizontally-scrollable":
        geom.consoleHorizontalScrollable === false,
      "rows-not-horizontally-scrollable": geom.rowsFit === true,
      "footer-visible": geom.footerVisible === true,
    };
    const failedLayout = Object.keys(layoutChecks).filter(
      (key) => !layoutChecks[key],
    );
    if (failedLayout.length > 0) {
      result.failed = true;
      result.steps.push({ step: "layout-checks-failed", failedLayout, geom });
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
