"use strict";

// app:// 自定义协议路径穿越防护回归测试。
// 验证 resolveAssetPath 的安全不变式：任意输入 URL 解析结果要么为 null，
// 要么落在 assets/ 根目录之内，永不逃逸到应用其它目录。
// 约定：observed=0 且 exit 0 表示通过；observed>0 表示有断言失败（防护被削弱）。

const path = require("path");
const Module = require("module");

// 用固定 appPath 模拟 Electron 运行环境，使 assetsRoot() 可预测（无需真实启动 Electron）。
const FAKE_APP_PATH = path.resolve(__dirname, "../../..");
const electronStub = {
  app: { getAppPath: () => FAKE_APP_PATH },
  protocol: {
    registerSchemesAsPrivileged: () => {},
    handle: () => {},
  },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "electron") return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};
const { resolveAssetPath } = require("../../../src/asset-protocol");
const { assetsRoot } = require("../../../src/asset-url");
Module._load = originalLoad; // 还原，避免污染后续 require

const ROOT = assetsRoot(); // <repo>/assets
const sep = path.sep;

function withinRoot(p) {
  return p === ROOT || p.startsWith(ROOT + sep);
}

const failures = [];

// 1) 正常请求：必须解析为 assets/ 下确切的绝对路径。
const positiveCases = [
  ["plain html", "app://bundle/index.html", "index.html"],
  ["nested asset", "app://bundle/css/print-lock.css", "css/print-lock.css"],
  ["encoded space in name", "app://bundle/a%20b.js", "a b.js"],
];
for (const [desc, url, rel] of positiveCases) {
  const got = resolveAssetPath(url);
  const want = path.join(ROOT, ...rel.split("/"));
  if (got !== want) {
    failures.push({
      kind: "positive-mismatch",
      desc,
      url,
      want,
      got,
    });
  }
}

// 2) 非法请求：必须返回 null（主机不符 / 协议不符 / 空路径 / 编码穿越逃逸）。
const rejectCases = [
  ["wrong host", "app://evil/index.html"],
  ["wrong scheme", "file://bundle/index.html"],
  ["empty path slash", "app://bundle/"],
  ["empty path bare", "app://bundle"],
  ["encoded slash escape", "app://bundle/..%2f..%2f..%2fmain.js"],
  ["encoded dot escape", "app://bundle/%2e%2e%2f%2e%2e%2fpackage.json"],
  ["mixed encoded escape", "app://bundle/foo/..%2f..%2f..%2f..%2fpackage.json"],
];
for (const [desc, url] of rejectCases) {
  const got = resolveAssetPath(url);
  if (got !== null) {
    failures.push({ kind: "reject-not-null", desc, url, got });
  }
}

// 3) 安全不变式：任意（含畸形）输入解析结果要么 null，要么仍在 assets/ 根内，绝不逃逸。
const invariantCases = [
  "app://bundle/../main.js",
  "app://bundle/foo/../../../main.js",
  "app://bundle/....//....//main.js",
  "app://bundle/..\\..\\main.js",
  "app://bundle/%2e%2e/%2e%2e/main.js",
  "app://bundle/./././index.html",
  "app://bundle/sub/../index.html",
];
for (const url of invariantCases) {
  let got;
  try {
    got = resolveAssetPath(url);
  } catch (err) {
    failures.push({ kind: "invariant-threw", url, error: String(err) });
    continue;
  }
  if (got !== null && !withinRoot(got)) {
    failures.push({ kind: "invariant-escape", url, got });
  }
}

const result = {
  root: ROOT,
  observed: failures.length,
  failures,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = failures.length > 0 ? 1 : 0;
