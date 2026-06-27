"use strict";

// 软件日志视图纯模型安全回归。
// 验证 SoftwareLogView 的过滤/高亮 helper 仍保持：
//   1) v-html 前先 HTML 转义；
//   2) 高亮在已转义文本上执行，含 < > & " ' 的关键字可匹配；
//   3) level folding 保持 info→verbose、debug→silly；
//   4) footer 文案保持 sqlite/software_logs 契约。
// 运行：node tools/repro/security/software-log-view-model-check.js
// 约定：stdout 打印 SOFTWARE_LOG_VIEW_MODEL_RESULT <json>，failed=false 且退出码 0 表示通过。

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MODEL_PATH = path.join(
  REPO_ROOT,
  "src/renderer/app/windows/console/views/software-log-view-model.ts",
);

function loadModel() {
  const source = fs.readFileSync(MODEL_PATH, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: MODEL_PATH,
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
  };
  sandbox.module.exports = sandbox.exports;
  vm.createContext(sandbox);
  new vm.Script(transpiled, { filename: MODEL_PATH }).runInContext(sandbox);
  return sandbox.module.exports;
}

function fail(result, step, details) {
  result.failed = true;
  result.steps.push({ step, details });
}

const result = { failed: false, steps: [] };

try {
  const model = loadModel();
  const lines = [
    { ts: "2026-06-25 10:00:00", level: "info", msg: "<info>& \" '" },
    {
      ts: "2026-06-25 10:00:01",
      level: "error",
      msg: "<img src=x onerror=alert(1)>",
    },
    { ts: "2026-06-25 10:00:02", level: "verbose", msg: "verbose row" },
    { ts: "2026-06-25 10:00:03", level: "silly", msg: "debug row" },
  ];

  const escaped = model.escapeSoftwareLogHtml("<script>&\"'");
  if (escaped !== "&lt;script&gt;&amp;&quot;&#39;") {
    fail(result, "escape-html", { got: escaped });
  }

  const highlighted = model.buildSoftwareLogDisplayLines(lines, "", "<INFO>");
  if (highlighted.length !== 1) {
    fail(result, "keyword-filter-count", { got: highlighted });
  } else {
    const html = highlighted[0].html;
    if (!html.includes('<span class="hl">&lt;info&gt;</span>')) {
      fail(result, "escaped-keyword-highlight-missing", { got: html });
    }
    if (html.includes("<info>") || html.includes("<script")) {
      fail(result, "raw-html-leaked", { got: html });
    }
  }

  const xss = model.buildSoftwareLogDisplayLines(lines, "", "img");
  if (xss.length !== 1 || xss[0].html.includes("<img")) {
    fail(result, "xss-line-not-escaped", { got: xss });
  }
  if (!xss[0] || !xss[0].html.includes('&lt;<span class="hl">img</span>')) {
    fail(result, "xss-highlight-not-on-escaped-html", { got: xss });
  }

  const infoRows = model.buildSoftwareLogDisplayLines(lines, "info", "");
  if (infoRows.map((line) => line.level).join(",") !== "info,verbose") {
    fail(result, "info-folding", { got: infoRows });
  }

  const debugRows = model.buildSoftwareLogDisplayLines(lines, "debug", "");
  if (debugRows.map((line) => line.level).join(",") !== "silly") {
    fail(result, "debug-folding", { got: debugRows });
  }

  const source = model.formatSoftwareLogFooterSource("2026-06-25");
  if (source !== "sqlite/software_logs · 2026-06-25") {
    fail(result, "footer-source", { got: source });
  }

  const count = model.formatSoftwareLogFooterCount(1, 4);
  if (count !== "1 / 4 行") {
    fail(result, "footer-count", { got: count });
  }
} catch (err) {
  fail(result, "exception", String((err && err.stack) || err));
}

console.log("SOFTWARE_LOG_VIEW_MODEL_RESULT " + JSON.stringify(result));
process.exit(result.failed ? 1 : 0);
