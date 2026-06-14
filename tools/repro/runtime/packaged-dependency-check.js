"use strict";

// 验证打包后的 app.asar 携带主进程运行时依赖。
// 运行：node tools/repro/runtime/packaged-dependency-check.js [app.asar路径]
// 默认检查 out/win-unpacked/resources/app.asar。

const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const repoRoot = path.resolve(__dirname, "../../..");
const appAsarPath =
  process.argv[2] ||
  path.join(repoRoot, "out", "win-unpacked", "resources", "app.asar");

const requiredFiles = [
  "/tools/utils.js",
  "/src/pdf-print.js",
  "/node_modules/ipp/ipp.js",
  "/node_modules/ipp/package.json",
];

function finish(result) {
  result.failed = Boolean(result.failed);
  console.log("SMOKE_RESULT " + JSON.stringify(result, null, 2));
  process.exitCode = result.failed ? 1 : 0;
}

if (!fs.existsSync(appAsarPath)) {
  finish({
    failed: true,
    appAsarPath,
    missingArchive: true,
  });
  return;
}

const files = new Set(
  asar.listPackage(appAsarPath).map((item) => item.replace(/\\/g, "/")),
);
const missing = requiredFiles.filter((filePath) => !files.has(filePath));

finish({
  appAsarPath,
  checked: requiredFiles,
  missing,
  failed: missing.length > 0,
});
