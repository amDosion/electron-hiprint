"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const files = [
  "main.js",
  "src/set.js",
  "src/print.js",
  "src/render.js",
  "src/printLog.js",
];
const risks = [];

// Electron 沙箱化 preload 仅能 require 这一受限子集（其余 Node CommonJS 模块会被阻断）
const SANDBOX_SAFE_PRELOAD_MODULES = new Set([
  "electron",
  "events",
  "timers",
  "timers/promises",
  "url",
]);

// 解析窗口定义里的 preload 路径并检测它是否仍 require 被沙箱阻断的模块
function findSandboxBlockedPreloadRequires(windowFile, windowContent) {
  const match = windowContent.match(
    /preload:\s*path\.join\(\s*__dirname\s*,\s*["'`]([^"'`]+)["'`]\s*\)/,
  );
  if (!match) return null;
  const preloadPath = path.resolve(
    path.dirname(path.join(repoRoot, windowFile)),
    match[1],
  );
  if (!fs.existsSync(preloadPath)) return null;
  const preloadContent = fs.readFileSync(preloadPath, "utf8");
  const requireRe = /require\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
  const blocked = [];
  let m;
  while ((m = requireRe.exec(preloadContent)) !== null) {
    if (!SANDBOX_SAFE_PRELOAD_MODULES.has(m[1])) blocked.push(m[1]);
  }
  return blocked.length ? { preloadPath, blocked } : null;
}

for (const relativePath of files) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  if (/path\.join\(\s*["']file:\/\//.test(content)) {
    risks.push({
      id: "RUNTIME-WINDOWS-FILE-URL-PATH-JOIN",
      severity: "critical",
      file: relativePath,
      detail:
        'path.join("file://", ...) creates invalid Windows URLs such as .\\file:\\C:\\..., leaving packaged windows blank.',
    });
  }
  if (
    /preload:\s*path\.join\(__dirname/.test(content) &&
    !/sandbox:\s*false/.test(content)
  ) {
    const blocked = findSandboxBlockedPreloadRequires(relativePath, content);
    if (blocked) {
      const preloadRel = path
        .relative(repoRoot, blocked.preloadPath)
        .replace(/\\/g, "/");
      risks.push({
        id: "RUNTIME-PRELOAD-SANDBOX-BLOCKS-COMMONJS",
        severity: "critical",
        file: relativePath,
        detail: `Sandbox is enabled but preload ${preloadRel} still requires sandbox-blocked module(s): ${blocked.blocked.join(
          ", ",
        )}. Migrate these to synchronous IPC.`,
      });
    }
  }
}

const helperPath = path.join(repoRoot, "src/asset-url.js");
if (!fs.existsSync(helperPath)) {
  risks.push({
    id: "RUNTIME-ASSET-URL-HELPER-MISSING",
    severity: "high",
    detail: "Window asset loading should use a shared pathToFileURL helper.",
  });
} else {
  const helper = fs.readFileSync(helperPath, "utf8");
  if (!/pathToFileURL/.test(helper)) {
    risks.push({
      id: "RUNTIME-ASSET-URL-HELPER-NOT-USING-PATH-TO-FILE-URL",
      severity: "high",
      detail:
        "The shared helper must use node:url pathToFileURL for Windows-safe file URLs.",
    });
  }
  if (!/app\.asar\.unpacked/.test(helper)) {
    risks.push({
      id: "RUNTIME-FILE-ASSET-URL-STILL-POINTS-AT-ASAR",
      severity: "high",
      detail:
        "Packaged file:// print/render windows must load from app.asar.unpacked to avoid Electron asar lstat deprecation warnings.",
    });
  }
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const asarUnpack = new Set(packageJson.build && packageJson.build.asarUnpack);
[
  "assets/**",
  "node_modules/jquery/dist/jquery.min.js",
  "node_modules/nzh/dist/nzh.min.js",
  "node_modules/bwip-js/dist/bwip-js.js",
  "node_modules/jsbarcode/dist/JsBarcode.all.min.js",
].forEach((pattern) => {
  if (!asarUnpack.has(pattern)) {
    risks.push({
      id: "RUNTIME-FILE-ASSET-MISSING-ASAR-UNPACK",
      severity: "high",
      file: "package.json",
      detail: `Missing build.asarUnpack entry required by hidden print/render file windows: ${pattern}`,
    });
  }
});

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
