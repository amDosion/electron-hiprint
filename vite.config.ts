import { defineConfig } from "vite";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import AutoImport from "unplugin-auto-import/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";
import { viteSingleFile } from "vite-plugin-singlefile";

// electron-hiprint 渲染层（Vue 3 + TS + element-plus）。
// 窗口经自定义 app:// 协议加载（见 src/asset-protocol.js）。用 vite-plugin-singlefile
// 把每个窗口打成自包含单 HTML（内联全部 JS/CSS）输出到 assets/，使 handler 只需伺服
// 单个文件、无需解析众多 chunk，getAssetUrl("xxx.html") 保持不变。
const rendererRoot = resolve(__dirname, "src/renderer");

// 已移植为 SFC 的窗口入口表。新增窗口在此登记即可。
const WINDOW_ENTRIES: Record<string, string> = {
  index: resolve(rendererRoot, "index.html"),
  set: resolve(rendererRoot, "set.html"),
  printLog: resolve(rendererRoot, "printLog.html"),
  softwareLog: resolve(rendererRoot, "softwareLog.html"),
  // 打印渲染窗口（非 Vue 纯 TS 入口）：经 ESM 内联消费 @amdosion/vue3-print，取代旧 runtime.js。
  render: resolve(rendererRoot, "render.html"),
};

// 构建时 tools/build-renderer.js 会逐窗口设置 VITE_WINDOW；singlefile 只支持单入口。
// 未设置（dev server）时返回全部窗口。
function pickInput(): Record<string, string> {
  const target = process.env.VITE_WINDOW;
  if (target && WINDOW_ENTRIES[target]) {
    return { [target]: WINDOW_ENTRIES[target] };
  }
  return WINDOW_ENTRIES;
}

export default defineConfig({
  root: rendererRoot,
  base: "./",
  plugins: [
    vue(),
    AutoImport({
      imports: ["vue"],
      resolvers: [ElementPlusResolver({ importStyle: "css" })],
      dts: resolve(rendererRoot, "app/types/auto-imports.d.ts"),
    }),
    Components({
      resolvers: [ElementPlusResolver({ importStyle: "css" })],
      dts: resolve(rendererRoot, "app/types/components.d.ts"),
    }),
    viteSingleFile(),
  ],
  resolve: {
    alias: {
      "@": resolve(rendererRoot, "app"),
    },
  },
  build: {
    outDir: resolve(__dirname, "assets"),
    emptyOutDir: false, // 关键：不清空 assets/，保留 render/print/loading 等静态资源
    target: "es2020",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000, // 全部内联，配合 singlefile
    rollupOptions: {
      // 渐进迁移：只列已移植为 SFC 的窗口；未列出的窗口保留 assets/ 下的静态 HTML 不被覆盖。
      // singlefile 强制 inlineDynamicImports:true，仅支持单入口，故构建时由 tools/build-renderer.js
      // 逐窗口设置 VITE_WINDOW 各构建一次；未设置时（如 dev server）列出全部窗口。
      input: pickInput(),
    },
  },
});
