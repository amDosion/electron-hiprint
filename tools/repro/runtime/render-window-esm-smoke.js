"use strict";

// render 打印渲染窗口 ESM 化冒烟（需真实 Electron）。
// 经 app:// 加载已构建的 assets/render.html（hiprint 已由 Vite 内联消费 @amdosion/vue3-print(ESM)，
// 不再注入外部 {version}_vue3-print.runtime.js），附真实 src/preload/render.js。
// 充当主进程：下发 "png"（含文本 + 条形码 + 二维码模板），断言：
//   1. 窗口经 app:// 加载成功（无 ERR_FAILED），origin 为 app://bundle；
//   2. hiprint 引擎已内联可用（window.jQuery 就位、无脚本错误）；
//   3. png 处理跑通：构建 PrintTemplate、getHtml 产出含 .hiprint-printPaper 的 DOM、
//      计算出有效 rect 并回送 capturePage（IPC 契约不变）；
//   4. 文本与条码/二维码均渲染出内容（验证移除 window 全局后插件内置依赖仍能出码）。
// 同时把渲染结果截图保存到 .investigations/verify-render-esm.png 供人工核对。
// 运行：npx electron tools/repro/runtime/render-window-esm-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const fs = require("fs");
const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

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
}, 30000);
killTimer.unref && killTimer.unref();

// 最小 hiprint 模板：文本 + 条形码 + 二维码，覆盖 jsbarcode/bwip-js 渲染路径。
const TEST_TEMPLATE = {
  panels: [
    {
      index: 0,
      name: 1,
      height: 80,
      width: 100,
      paperHeader: 0,
      paperFooter: 100,
      printElements: [
        {
          options: {
            left: 12,
            top: 8,
            height: 18,
            width: 200,
            title: "标题",
            field: "title",
            testData: "ESM 渲染验证",
            fontSize: 14,
          },
          printElementType: { title: "文本", type: "text" },
        },
        {
          options: {
            left: 12,
            top: 36,
            height: 36,
            width: 200,
            field: "code",
            testData: "1234567890",
            textType: "barcode",
            barcodeMode: "CODE128B",
          },
          printElementType: { title: "条形码", type: "barcode" },
        },
        {
          options: {
            left: 230,
            top: 36,
            height: 60,
            width: 60,
            field: "qr",
            testData: "https://hiprint.test/esm",
            textType: "qrcode",
          },
          printElementType: { title: "二维码", type: "qrcode" },
        },
      ],
    },
  ],
};

const TEST_DATA = {
  title: "ESM 渲染验证",
  code: "1234567890",
  qr: "https://hiprint.test/esm",
};

app.whenReady().then(async () => {
  registerAssetProtocol();

  const win = new BrowserWindow({
    show: false,
    width: 360,
    height: 560,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO_ROOT, "src/preload/render.js"),
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

  // 渲染页经 preload 把 capturePage 转发到主进程；收到即说明 png 链路跑通。
  const capturePromise = new Promise((resolve) => {
    ipcMain.once("capturePage", (_event, data) => resolve(data));
  });
  // 渲染页若报模板/插件错误会发 showMessageBox。
  ipcMain.on("showMessageBox", (_event, data) => {
    result.failed = true;
    result.steps.push({ step: "showMessageBox", box: data });
  });

  try {
    await win.loadURL("app://bundle/render.html");
    result.steps.push({ step: "loaded-render-html", ok: true });

    // 等待 main.ts 模块求值（注册 png/pdf/print 监听）。
    await new Promise((r) => setTimeout(r, 500));

    const pre = await win.webContents.executeJavaScript(`(async () => ({
      origin: location.origin,
      hasBridge: typeof window.hiprintRender === 'object' && window.hiprintRender !== null,
      hasJQuery: typeof window.jQuery === 'function',
      hasRuntimeScript: !!document.querySelector('script[src*="vue3-print.runtime"]'),
    }))()`);
    result.pre = pre;
    if (pre.origin !== "app://bundle") {
      result.failed = true;
      result.steps.push({ step: "origin-mismatch", got: pre.origin });
    }
    if (!pre.hasBridge) {
      result.failed = true;
      result.steps.push({ step: "render-bridge-missing" });
    }
    if (pre.hasRuntimeScript) {
      result.failed = true;
      result.steps.push({ step: "external-runtime-script-present" });
    }

    // 下发 png（与主进程 render.js 一致：data.template + data.data）。
    win.webContents.send("png", {
      clientType: "local",
      socketId: "smoke",
      taskId: "smoke-task",
      template: TEST_TEMPLATE,
      data: TEST_DATA,
    });

    const captured = await Promise.race([
      capturePromise,
      new Promise((_r, reject) =>
        setTimeout(
          () => reject(new Error("capturePage 超时（png 链路未回送）")),
          12000,
        ),
      ),
    ]);
    result.captured = {
      templateId: captured.templateId,
      x: captured.x,
      y: captured.y,
      width: captured.width,
      height: captured.height,
    };
    if (!(captured.width > 0) || !(captured.height > 0)) {
      result.failed = true;
      result.steps.push({
        step: "invalid-capture-rect",
        rect: result.captured,
      });
    }

    // 核验渲染 DOM：纸张、文本、条码/二维码均出内容。
    const dom = await win.webContents.executeJavaScript(`(async () => {
      const paper = document.querySelector('.hiprint-printPaper');
      const root = document.getElementById('printElement');
      const text = root ? root.textContent || '' : '';
      // 条码/二维码渲染产物：svg(jsbarcode) / img / canvas
      const codeNodes = root ? root.querySelectorAll('svg, img, canvas') : [];
      return {
        hasPaper: !!paper,
        elementCount: root ? root.querySelectorAll('.hiprint-printElement').length : -1,
        textHasTitle: text.indexOf('ESM 渲染验证') >= 0,
        codeNodeCount: codeNodes.length,
      };
    })()`);
    result.dom = dom;
    if (!dom.hasPaper) {
      result.failed = true;
      result.steps.push({ step: "no-print-paper" });
    }
    if (!dom.textHasTitle) {
      result.failed = true;
      result.steps.push({ step: "text-not-rendered" });
    }
    if (!(dom.codeNodeCount >= 1)) {
      result.failed = true;
      result.steps.push({
        step: "barcode-not-rendered",
        got: dom.codeNodeCount,
      });
    }

    // 截图保存（resize 到内容尺寸，便于人工核对）。
    try {
      const w = Math.max(60, Math.ceil(captured.width));
      const h = Math.max(60, Math.ceil(captured.height));
      win.setContentSize(w, h, false);
      await new Promise((r) => setTimeout(r, 200));
      const image = await win.webContents.capturePage();
      const outDir = path.join(REPO_ROOT, ".investigations");
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, "verify-render-esm.png");
      fs.writeFileSync(outPath, image.toPNG());
      result.screenshot = outPath;
    } catch (capErr) {
      result.steps.push({ step: "screenshot-failed", error: String(capErr) });
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
