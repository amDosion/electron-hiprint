"use strict";

// 设置窗口 SFC 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/set.html，附真实 src/preload/set.js（暴露 hiprintSet 桥）。
// 断言：加载成功、Vue 根挂载、3 个 tab、表单与基础设置字段、应用/关闭按钮、无脚本错误。
// 主进程 IPC（getPrintersList 等）无人应答属正常。
// 运行：npx electron tools/repro/runtime/set-window-render-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// preload/set.js 在加载时 sendSync 同步取设置快照（阻塞渲染直到主进程应答）。
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
// setContentSize 等异步通道无需应答
ipcMain.on("setContentSize", () => {});

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
    width: 520,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO_ROOT, "src/preload/set.js"),
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
    await win.loadURL("app://bundle/set.html");
    result.steps.push({ step: "loaded-set-html", ok: true });
    await new Promise((r) => setTimeout(r, 600));

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      out.hasBridge = typeof window.hiprintSet === 'object' && window.hiprintSet !== null;
      const appEl = document.querySelector('#app');
      out.appChildCount = appEl ? appEl.children.length : -1;
      out.tabCount = document.querySelectorAll('.el-tabs__item').length;
      out.hasForm = !!document.querySelector('.el-form');
      out.hasPortInput = !!document.querySelector('.el-input-number');
      out.inputCount = document.querySelectorAll('.el-form .el-input').length;
      out.buttonText = Array.from(document.querySelectorAll('.el-form .el-button')).map(b => b.textContent.trim());
      out.activeTab = (document.querySelector('.el-tabs__item.is-active') || {}).textContent || '';
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
    if (probe.appChildCount < 1 || !probe.hasForm) {
      result.failed = true;
      result.steps.push({
        step: "vue-not-mounted",
        childCount: probe.appChildCount,
        form: probe.hasForm,
      });
    }
    if (probe.tabCount !== 3) {
      result.failed = true;
      result.steps.push({ step: "tab-count-wrong", got: probe.tabCount });
    }
    if (!probe.hasPortInput) {
      result.failed = true;
      result.steps.push({ step: "port-input-missing" });
    }
    const joinedBtns = (probe.buttonText || []).join("|");
    if (!/应用/.test(joinedBtns) || !/关闭/.test(joinedBtns)) {
      result.failed = true;
      result.steps.push({
        step: "action-buttons-missing",
        got: probe.buttonText,
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
