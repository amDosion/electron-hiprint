"use strict";

// 逐窗口构建渲染层 SFC。为每个窗口设置 VITE_WINDOW 各跑一次 `vite build`，
// 由 vite.config.ts 的 pickInput() 据此选出单一入口。逐窗口构建用于窗口隔离：
// console 与 render 的依赖体积差异很大；单次合并构建可能让公共 chunk 把控制台依赖拖进
// 打印渲染窗口，按需树摇白做。逐窗口构建保证 render 入口只含自身用到的依赖。
// 产物：窗口 HTML 落在 assets/，引用的 JS/CSS chunk 落在 assets/assets/，
// 由 app:// handler 按扩展名带正确 MIME 流式伺服（见 src/asset-protocol.js）。
// 新增窗口：在 WINDOWS 与 vite.config.ts 的 WINDOW_ENTRIES 同步登记。

const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

// L3 重构完成：index/set/printLog/softwareLog 已合并为 console 单页，旧入口已删除。
const WINDOWS = ["console", "render"];

const assetsDir = path.resolve(__dirname, "../assets");

// 构建前清理上一轮的生成产物，避免内容哈希变更后 assets/assets/ 残留陈旧 chunk。
// 只删生成物：各窗口 HTML + assets/assets/（Vite chunk 目录）；
// 保留静态资源：print.html / loading.html / css/ / icons/。
function cleanGeneratedOutputs() {
  for (const name of WINDOWS) {
    const html = path.join(assetsDir, `${name}.html`);
    if (fs.existsSync(html)) fs.rmSync(html);
  }
  const chunkDir = path.join(assetsDir, "assets");
  if (fs.existsSync(chunkDir))
    fs.rmSync(chunkDir, { recursive: true, force: true });
}

cleanGeneratedOutputs();

const isWin = process.platform === "win32";
const viteBin = path.resolve(
  __dirname,
  "../node_modules/.bin/",
  isWin ? "vite.cmd" : "vite",
);

for (const name of WINDOWS) {
  console.log(`\n[build-renderer] building ${name} ...`);
  const result = spawnSync(viteBin, ["build"], {
    stdio: "inherit",
    env: { ...process.env, VITE_WINDOW: name },
    shell: isWin, // Windows 下 .cmd 需经 shell 解析
  });
  if (result.status !== 0) {
    console.error(`[build-renderer] FAILED building ${name}`);
    process.exit(result.status || 1);
  }
}

console.log("\n[build-renderer] all windows built.");
