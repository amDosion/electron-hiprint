"use strict";

// 逐窗口构建渲染层 SFC。vite-plugin-singlefile 强制 inlineDynamicImports:true，
// 只支持单入口，因此这里为每个窗口设置 VITE_WINDOW 各跑一次 `vite build`，
// 由 vite.config.ts 的 pickInput() 据此选出单一入口，输出自包含单 HTML 到 assets/。
// 新增窗口：在 WINDOWS 与 vite.config.ts 的 WINDOW_ENTRIES 同步登记。

const path = require("path");
const { spawnSync } = require("child_process");

const WINDOWS = ["index", "set", "printLog", "softwareLog", "render"];

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
