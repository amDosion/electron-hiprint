"use strict";

// 设置视图 SFC 渲染冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/console.html#/settings/basic，附真实 src/preload/console.js。
// 断言：加载成功、Vue 根挂载、主左侧栏拆成基础/中转/高级配置三个入口、
// 设置页内部不再渲染二级 tab、表单与基础设置字段、应用/关闭按钮可读、无脚本错误。
// 主进程 IPC（getPrintersList 等）无人应答属正常。
// 运行：npx electron tools/repro/runtime/set-window-render-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const fs = require("fs");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// console.js preload 在加载时 sendSync 同步取主标题、版本和设置快照。
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
// 设置视图异步通道无需应答
ipcMain.on("setContentSize", () => {});
ipcMain.on("getPrintersList", () => {});

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
    width: 1120,
    height: 720,
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
  win.webContents.on("console-message", (_e, level, message) => {
    if (level >= 3) result.consoleErrors.push(message);
  });

  try {
    await win.loadURL("app://bundle/console.html#/settings/basic");
    result.steps.push({ step: "loaded-settings-route", ok: true });
    await new Promise((r) => setTimeout(r, 600));

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      out.hash = location.hash;
      out.hasBridge = typeof window.hiprintSet === 'object' && window.hiprintSet !== null;
      const appEl = document.querySelector('#app');
      out.appChildCount = appEl ? appEl.children.length : -1;
      out.shellNavLabels = Array.from(document.querySelectorAll('.shell-nav span')).map((el) => el.textContent.trim());
      out.activeShellNav = (document.querySelector('.shell-nav.active span') || {}).textContent || '';
      out.internalSettingsTabCount =
        document.querySelectorAll('.settings-tab').length +
        document.querySelectorAll('.cv-settings .el-tabs').length;
      out.settingsHeading = (document.querySelector('.settings-header h1') || {}).textContent || '';
      out.hasForm = !!document.querySelector('.el-form');
      out.hasPortInput = !!document.querySelector('.el-input-number');
      out.inputCount = document.querySelectorAll('.el-form .el-input').length;
      out.buttonText = Array.from(document.querySelectorAll('.el-form .el-button')).map(b => b.textContent.trim());
      const buttons = Array.from(document.querySelectorAll('.el-form .el-button'));
      out.buttonStyles = buttons.map((button) => {
        const styles = getComputedStyle(button);
        return {
          text: button.textContent.trim(),
          color: styles.color,
          backgroundColor: styles.backgroundColor,
          borderColor: styles.borderColor,
        };
      });
      return out;
    })()`);
    result.probe = probe;

    if (process.env.HIPRINT_CAPTURE_SETTINGS_OUT) {
      const capturePath = path.resolve(REPO_ROOT, process.env.HIPRINT_CAPTURE_SETTINGS_OUT);
      fs.mkdirSync(path.dirname(capturePath), { recursive: true });
      const image = await win.capturePage();
      fs.writeFileSync(capturePath, image.toPNG());
      result.capturePath = capturePath;
    }

    if (probe.origin !== "app://bundle") {
      result.failed = true;
      result.steps.push({ step: "origin-mismatch", got: probe.origin });
    }
    if (probe.hash !== "#/settings/basic") {
      result.failed = true;
      result.steps.push({ step: "route-mismatch", got: probe.hash });
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
    const navLabels = probe.shellNavLabels || [];
    for (const label of ["基础设置", "中转设置", "高级配置"]) {
      if (!navLabels.includes(label)) {
        result.failed = true;
        result.steps.push({ step: "settings-nav-label-missing", label, got: navLabels });
      }
    }
    if (navLabels.includes("设置")) {
      result.failed = true;
      result.steps.push({ step: "legacy-settings-nav-still-rendered", got: navLabels });
    }
    if (probe.activeShellNav !== "基础设置") {
      result.failed = true;
      result.steps.push({ step: "active-settings-nav-wrong", got: probe.activeShellNav });
    }
    if (probe.internalSettingsTabCount !== 0) {
      result.failed = true;
      result.steps.push({ step: "internal-settings-tabs-still-rendered", got: probe.internalSettingsTabCount });
    }
    if (probe.settingsHeading !== "基础设置") {
      result.failed = true;
      result.steps.push({ step: "settings-heading-wrong", got: probe.settingsHeading });
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
    const primaryButton = (probe.buttonStyles || []).find((button) => button.text === "应用");
    const closeButton = (probe.buttonStyles || []).find((button) => button.text === "关闭");
    if (!primaryButton || primaryButton.backgroundColor === "rgb(255, 255, 255)") {
      result.failed = true;
      result.steps.push({ step: "primary-button-background-invisible", got: primaryButton });
    }
    if (!closeButton || closeButton.color === closeButton.backgroundColor) {
      result.failed = true;
      result.steps.push({ step: "secondary-button-text-invisible", got: closeButton });
    }
    if (result.consoleErrors.length > 0) {
      result.failed = true;
    }

    const routeChecks = await win.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const checks = [];
      for (const label of ['中转设置', '高级配置']) {
        const button = Array.from(document.querySelectorAll('.shell-nav')).find((item) => item.textContent.trim() === label);
        if (!button) {
          checks.push({ label, found: false });
          continue;
        }
        button.click();
        await sleep(250);
        checks.push({
          label,
          found: true,
          hash: location.hash,
          activeShellNav: (document.querySelector('.shell-nav.active span') || {}).textContent || '',
          heading: (document.querySelector('.settings-header h1') || {}).textContent || '',
        });
      }
      return checks;
    })()`);
    result.routeChecks = routeChecks;
    for (const check of routeChecks || []) {
      if (!check.found || check.activeShellNav !== check.label || check.heading !== check.label) {
        result.failed = true;
        result.steps.push({ step: "settings-nav-route-check-failed", check });
      }
    }
  } catch (err) {
    result.failed = true;
    result.error = String((err && err.stack) || err);
  }

  clearTimeout(killTimer);
  finish(result);
});

app.on("window-all-closed", () => {});
