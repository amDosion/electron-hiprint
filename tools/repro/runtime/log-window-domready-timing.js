"use strict";

// 日志窗口 dom-ready 计时探针（需真实 Electron）。
// 忠实复刻托盘点击开窗路径：show:false 隐藏窗 + loading 浮层 + 经 app:// loadURL 窗口 HTML，
// 记录 domReady(DOMContentLoaded) / didFinishLoad / overlayRemoved。每个窗口连开两次：
//   cold = 首次（含 V8 编译）；warm = 二次（命中 app:// standard 源的磁盘 code cache）。
// 用于验证去 vite-plugin-singlefile（产物多 chunk、按需 EP 树摇）后窗口打开是否更快。
// 运行：npx electron tools/repro/runtime/log-window-domready-timing.js
// 约定：stdout 打印 TIMING_RESULT <json>，退出码 0。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// printLog 的 preload 在加载时 sendSync('hiprint:store-get','rePrint') 同步阻塞渲染，直到主进程应答。
// 不 mock 该处理器会令 printLog 渲染进程卡死 → loadURL 报 ERR_FAILED（与产物无关，纯测试桩缺失）。
ipcMain.on("hiprint:store-get", (event, key) => {
  event.returnValue = key === "rePrint" ? 1 : undefined;
});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));
const { getAssetUrl } = require(path.join(REPO_ROOT, "src/asset-url"));
const { attachLoadingView } = require(path.join(REPO_ROOT, "src/loading-view"));

registerAssetSchemeAsPrivileged();
app.disableHardwareAcceleration();

function finish(result) {
  result.failed = Boolean(result.failed);
  console.log("TIMING_RESULT " + JSON.stringify(result, null, 2));
  app.exit(result.failed ? 1 : 0);
}

const killTimer = setTimeout(
  () => finish({ failed: true, reason: "timeout" }),
  60000,
);
killTimer.unref && killTimer.unref();

// 打开一次窗口并采集计时，窗口销毁后返回。
function openOnce(name, preload) {
  return new Promise((resolve) => {
    const start = Date.now();
    const events = {
      domReady: null,
      didFinishLoad: null,
      overlayRemoved: null,
    };
    const failedLoads = [];

    const win = new BrowserWindow({
      show: false,
      width: 1080,
      height: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload,
      },
    });

    win.webContents.on("dom-ready", () => {
      if (events.domReady === null) events.domReady = Date.now() - start;
    });
    win.webContents.on("did-finish-load", () => {
      events.didFinishLoad = Date.now() - start;
    });
    win.webContents.on("did-fail-load", (_e, code, desc, url) => {
      failedLoads.push({ code, desc, url });
    });

    const overlay = attachLoadingView(
      win,
      { width: 1080, height: 600 },
      getAssetUrl("loading.html"),
    );
    const poll = setInterval(() => {
      if (overlay.isRemoved()) {
        events.overlayRemoved = Date.now() - start;
        clearInterval(poll);
        // 浮层移除（=dom-ready/did-finish-load 触发）后再宽限一帧即可销毁。
        setTimeout(() => {
          win.destroy();
          resolve({ events, failedLoads });
        }, 200);
      }
    }, 20);

    win.loadURL(getAssetUrl(`${name}.html`)).catch((err) => {
      failedLoads.push({ loadUrlError: String((err && err.message) || err) });
    });

    // 单窗兜底：浮层异常未移除时，6s 后强制收尾。
    setTimeout(() => {
      if (events.overlayRemoved === null) {
        clearInterval(poll);
        win.destroy();
        resolve({ events, failedLoads });
      }
    }, 6000);
  });
}

const TARGETS = [
  {
    name: "softwareLog",
    preload: path.join(REPO_ROOT, "src/preload/softwareLog.js"),
  },
  {
    name: "printLog",
    preload: path.join(REPO_ROOT, "src/preload/printLog.js"),
  },
];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// 单窗模式（SINGLE=<name>）：忠实复刻"一次托盘点击 = 一个进程开一个窗"的生产路径，
// 排除多窗连开对 net.fetch 流的压测干扰。多窗模式：依次冷/热各开一次。
const SINGLE = process.env.SINGLE;

app.whenReady().then(async () => {
  registerAssetProtocol();
  const result = { windows: [] };
  try {
    const targets = SINGLE ? TARGETS.filter((t) => t.name === SINGLE) : TARGETS;
    for (const t of targets) {
      const cold = await openOnce(t.name, t.preload);
      const entry = {
        name: t.name,
        coldDomReadyMs: cold.events.domReady,
        coldDidFinishLoadMs: cold.events.didFinishLoad,
        failedLoads: [...cold.failedLoads],
      };
      if (!SINGLE) {
        await delay(800); // 模拟托盘开关窗的真实间隔
        const warm = await openOnce(t.name, t.preload);
        entry.warmDomReadyMs = warm.events.domReady;
        entry.warmDidFinishLoadMs = warm.events.didFinishLoad;
        entry.failedLoads.push(...warm.failedLoads);
        await delay(800);
      }
      if (entry.failedLoads.length || entry.coldDomReadyMs === null)
        result.failed = true;
      result.windows.push(entry);
    }
  } catch (error) {
    result.failed = true;
    result.error = String((error && error.stack) || error);
  }
  clearTimeout(killTimer);
  finish(result);
});

app.on("window-all-closed", () => {});
