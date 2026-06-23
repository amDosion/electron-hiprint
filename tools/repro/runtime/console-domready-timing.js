"use strict";

// 控制台 SPA dom-ready 计时探针。
// 验证 L3 重构的核心机制：prewarmConsole() 后台预热（冷启动移到后台），
// showConsole(route) 只是 show()+发 console:navigate，应接近秒开。
// 同时断言路由切换不新开 BrowserWindow（单窗口 SPA）。
// 运行：npx electron tools/repro/runtime/console-domready-timing.js
// 约定：stdout 打印 TIMING_RESULT <json>，退出码 0（pass）/ 1（fail）。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// -------------------------------------------------------------------
// console.js preload 加载时会触发多个 sendSync：
//   hiprint:store-get → mainTitle / rePrint
//   hiprint:app-version
//   hiprint:settings-snapshot
// 不 mock 这些处理器会令渲染进程同步阻塞，loadURL 卡死。
// -------------------------------------------------------------------
ipcMain.on("hiprint:store-get", (event, key) => {
  if (key === "mainTitle") event.returnValue = "Electron-hiprint";
  else if (key === "rePrint") event.returnValue = 1;
  else event.returnValue = undefined;
});
ipcMain.on("hiprint:app-version", (event) => {
  event.returnValue = "0.0.0-repro";
});
ipcMain.on("hiprint:settings-snapshot", (event) => {
  event.returnValue = {};
});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));

registerAssetSchemeAsPrivileged();
// 与现有 log-window 探针保持一致：禁用 GPU 加速以加快无头环境启动。
// 注：这会低估安装态真实速度，但不影响机制（单窗口路由）验证。
app.disableHardwareAcceleration();

// -------------------------------------------------------------------
// 工具函数
// -------------------------------------------------------------------
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function finish(result) {
  result.failed = Boolean(result.failed);
  console.log("TIMING_RESULT " + JSON.stringify(result, null, 2));
  app.exit(result.failed ? 1 : 0);
}

// 全局超时兜底（60s）
const killTimer = setTimeout(
  () => finish({ failed: true, reason: "global-timeout" }),
  60000,
);
killTimer.unref && killTimer.unref();

// 轮询等待 hash 变为目标值，最多 maxMs 毫秒
async function waitForHash(webContents, expected, maxMs) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const hash = await webContents.executeJavaScript("location.hash");
      if (hash === expected) return hash;
    } catch (_) {
      // webContents 销毁或未就绪时忽略
    }
    await delay(100);
  }
  try {
    return await webContents.executeJavaScript("location.hash");
  } catch (_) {
    return null;
  }
}

// -------------------------------------------------------------------
// 主流程
// -------------------------------------------------------------------
app.whenReady().then(async () => {
  registerAssetProtocol();

  // 动态加载 app-window.js，确保 getAppPath() 已被覆盖
  const {
    prewarmConsole,
    showConsole,
    getAppWindow,
    destroyConsole,
  } = require(path.join(REPO_ROOT, "src/app-window"));

  const result = {
    coldDomReadyMs: null,
    warmOpenMs: null,
    hashAfterNav: null,
    hashAfterNav2: null,
    windowCountBeforeShow: null,
    windowCountAfterShow: null,
    windowCountDelta: null,
    windowCountAfterNav2: null,
    failed: false,
    errors: [],
  };

  try {
    // ---- Step 1: app ready 后调用 prewarmConsole()，记录 coldDomReadyMs ----
    const prewarmStart = Date.now();
    prewarmConsole();

    const win = getAppWindow();
    if (!win || win.isDestroyed()) {
      result.failed = true;
      result.errors.push("prewarmConsole() 后 getAppWindow() 返回 null");
      clearTimeout(killTimer);
      destroyConsole();
      return finish(result);
    }

    // 等待 dom-ready（后台预热的首帧冷加载时间）
    await new Promise((resolve) => {
      win.webContents.once("dom-ready", () => {
        result.coldDomReadyMs = Date.now() - prewarmStart;
        resolve();
      });
      // 兜底：dom-ready 超过 30s 视为失败
      setTimeout(() => {
        if (result.coldDomReadyMs === null) {
          result.failed = true;
          result.errors.push("等待 dom-ready 超时（30s）");
          resolve();
        }
      }, 30000);
    });

    if (result.failed) {
      clearTimeout(killTimer);
      destroyConsole();
      return finish(result);
    }

    // 等待渲染完成（did-finish-load），给 Vue Router 挂载留足时间
    if (win.webContents.isLoading()) {
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    }
    // 额外等待 500ms，确保 AppShell onMounted + router ready
    await delay(500);

    // ---- Step 2: 记录 warmOpenMs（showConsole 到窗口可见的延时）----
    result.windowCountBeforeShow = BrowserWindow.getAllWindows().length;

    const showStart = Date.now();
    // showConsole 不新建窗口，只 show() + focus() + send console:navigate
    await showConsole("/software-log");
    result.warmOpenMs = Date.now() - showStart;

    result.windowCountAfterShow = BrowserWindow.getAllWindows().length;
    result.windowCountDelta =
      result.windowCountAfterShow - result.windowCountBeforeShow;

    // ---- Step 3: 断言 hash 切到 #/software-log（给 console:navigate 生效时间）----
    result.hashAfterNav = await waitForHash(
      win.webContents,
      "#/software-log",
      3000,
    );

    if (result.hashAfterNav !== "#/software-log") {
      result.failed = true;
      result.errors.push(
        `hash 断言失败：期望 #/software-log，实际 ${result.hashAfterNav}`,
      );
    }

    // ---- Step 4: 断言无新 BrowserWindow ----
    if (result.windowCountDelta !== 0) {
      result.failed = true;
      result.errors.push(
        `窗口数增量应为 0，实际 ${result.windowCountDelta}（before=${result.windowCountBeforeShow} after=${result.windowCountAfterShow}）`,
      );
    }

    // ---- Step 5: 再切一次路由到 /print-log ----
    await showConsole("/print-log");
    await delay(500);

    result.hashAfterNav2 = await waitForHash(
      win.webContents,
      "#/print-log",
      3000,
    );
    result.windowCountAfterNav2 = BrowserWindow.getAllWindows().length;

    if (result.hashAfterNav2 !== "#/print-log") {
      result.failed = true;
      result.errors.push(
        `第二次 hash 断言失败：期望 #/print-log，实际 ${result.hashAfterNav2}`,
      );
    }
    if (result.windowCountAfterNav2 !== result.windowCountAfterShow) {
      result.failed = true;
      result.errors.push(
        `第二次路由切换后窗口数变化：期望 ${result.windowCountAfterShow}，实际 ${result.windowCountAfterNav2}`,
      );
    }
  } catch (err) {
    result.failed = true;
    result.errors.push(String((err && err.stack) || err));
  }

  clearTimeout(killTimer);

  // ---- Step 6: 清理并输出结果 ----
  destroyConsole();
  finish(result);
});

// 阻止"所有窗口关闭"时自动退出，让探针主动控制退出时机
app.on("window-all-closed", () => {});
