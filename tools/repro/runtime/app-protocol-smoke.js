"use strict";

// app:// 自定义协议端到端冒烟（需真实 Electron 运行）。
// 复用生产模块 src/asset-protocol.js + src/asset-url.js，验证：
//   1. app:// 注册为标准+安全来源，真实窗口能从 app:// 加载页面（did-finish-load）；
//   2. 页面 origin 为 app://bundle（真实安全来源，非 file:// 不透明来源）；
//   3. handler 能从 assets/ 取真实窗口 HTML（已构建的 index.html），content-type 为
//      text/html（证明 MIME 标注与 Response 接线正确）；
//   4. handler 能伺服 index.html 引用的外链 JS chunk（assets/assets/*.js），content-type 为
//      text/javascript（证明去 singlefile 后多 chunk 产物在 app:// standard+secure 源下
//      能作为 ES module 正确加载执行——这是本协议设计的目标路径）；
//   5. 路径穿越请求被 handler 拒绝（HTTP 403）。
// 运行：npx electron tools/repro/runtime/app-protocol-smoke.js
// 约定：stdout 打印 SMOKE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow } = electron;

// 以脚本方式运行 electron 时 getAppPath() 不一定指向仓库根，
// 这里固定为仓库根，使 assetsRoot() 指向真实 assets/（复用生产解析逻辑）。
app.getAppPath = () => REPO_ROOT;

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));

// 必须在 ready 之前注册 privileged scheme。
registerAssetSchemeAsPrivileged();
app.disableHardwareAcceleration();

function finish(result) {
  result.failed = Boolean(result.failed);
  // 单行便于上层 grep 解析
  console.log("SMOKE_RESULT " + JSON.stringify(result));
  app.exit(result.failed ? 1 : 0);
}

// 安全网：避免任何挂起导致进程不退出。
const killTimer = setTimeout(() => {
  finish({ failed: true, steps: [{ step: "timeout" }] });
}, 25000);
killTimer.unref && killTimer.unref();

app.whenReady().then(async () => {
  registerAssetProtocol();

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const result = { steps: [] };

  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    result.failed = true;
    result.steps.push({ step: "did-fail-load", code, desc, url });
  });

  try {
    await win.loadURL("app://bundle/loading.html");
    result.steps.push({ step: "loaded-loading-html", ok: true });

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {};
      out.origin = location.origin;
      // 取一个真实生产窗口（已构建的 index.html），验证 handler 伺服与 MIME 标注。
      const r = await fetch('app://bundle/index.html');
      out.htmlOk = r.ok;
      out.htmlStatus = r.status;
      out.htmlType = r.headers.get('content-type');
      const body = await r.text();
      out.htmlLen = body.length;
      // 去 singlefile 后，index.html 以外链 <script type="module" src="./assets/xxx.js"> 引用 chunk。
      // 解析出首个 JS chunk 路径并经 app:// 取回，验证 .js 被带 text/javascript 正确伺服。
      const m = body.match(/src="(?:\\.\\/)?(assets\\/[^"]+\\.js)"/);
      out.chunkPath = m ? m[1] : null;
      if (out.chunkPath) {
        const jr = await fetch('app://bundle/' + out.chunkPath);
        out.jsOk = jr.ok;
        out.jsStatus = jr.status;
        out.jsType = jr.headers.get('content-type');
        out.jsLen = (await jr.text()).length;
      }
      let trav;
      try {
        const t = await fetch('app://bundle/..%2f..%2fpackage.json');
        trav = t.status;
      } catch (e) {
        trav = 'threw:' + e.message;
      }
      out.traversalStatus = trav;
      return out;
    })()`);
    result.probe = probe;

    if (probe.origin !== "app://bundle") {
      result.failed = true;
      result.steps.push({ step: "origin-mismatch", got: probe.origin });
    }
    if (!probe.htmlOk || probe.htmlStatus !== 200) {
      result.failed = true;
      result.steps.push({
        step: "html-fetch-failed",
        status: probe.htmlStatus,
      });
    }
    if (!/text\/html/.test(probe.htmlType || "")) {
      result.failed = true;
      result.steps.push({ step: "html-mime-wrong", got: probe.htmlType });
    }
    if (!(probe.htmlLen > 0)) {
      result.failed = true;
      result.steps.push({ step: "html-empty", len: probe.htmlLen });
    }
    if (!probe.chunkPath) {
      result.failed = true;
      result.steps.push({ step: "no-js-chunk-ref-in-html" });
    } else {
      if (!probe.jsOk || probe.jsStatus !== 200) {
        result.failed = true;
        result.steps.push({ step: "js-fetch-failed", status: probe.jsStatus });
      }
      if (!/javascript/.test(probe.jsType || "")) {
        result.failed = true;
        result.steps.push({ step: "js-mime-wrong", got: probe.jsType });
      }
      if (!(probe.jsLen > 0)) {
        result.failed = true;
        result.steps.push({ step: "js-empty", len: probe.jsLen });
      }
    }
    if (probe.traversalStatus !== 403) {
      result.failed = true;
      result.steps.push({
        step: "traversal-not-blocked",
        got: probe.traversalStatus,
      });
    }
  } catch (err) {
    result.failed = true;
    result.error = String((err && err.stack) || err);
  }

  clearTimeout(killTimer);
  finish(result);
});

app.on("window-all-closed", () => {});
