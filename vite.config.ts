import { defineConfig } from "vite";
import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import Components from "unplugin-vue-components/vite";
import AutoImport from "unplugin-auto-import/vite";
import { ElementPlusResolver } from "unplugin-vue-components/resolvers";

// electron-hiprint 渲染层（Vue 3 + TS + element-plus）。
// 窗口经自定义 app:// 协议加载（见 src/asset-protocol.js，已注册 standard+secure，
// 可正确执行外链 ES module）。HTML 输出到 assets/，引用的 JS/CSS chunk 落在 assets/assets/，
// 由 app:// handler 按扩展名带正确 MIME 流式伺服。
//
// 不再使用 vite-plugin-singlefile：它强制 rollup inlineDynamicImports:true，会打掉
// element-plus barrel 的树摇，使 ElementPlusResolver 的"按需"形同虚设——每个窗口都内联
// 全量 ~145 个组件(~1MB JS)，渲染进程 parse+compile+execute 这 1MB 才触发 dom-ready，
// 表现为打开打印记录/软件日志窗口白屏 ~2.4s（见
// .investigations/2026-06-17-log-window-dom-ready-full-element-plus.md）。
// 去掉 singlefile 后产物多 chunk，但树摇恢复，按需 EP 真正生效。
const rendererRoot = resolve(__dirname, "src/renderer");

// 已移植为 SFC 的窗口入口表。新增窗口在此登记即可。
// L3 重构完成：index/set/printLog/softwareLog 四窗口已合并为 console 单页，旧入口已删除。
const WINDOW_ENTRIES: Record<string, string> = {
  // 控制台单页（L3 重构：合并 index/set/printLog/softwareLog 四窗口）
  console: resolve(rendererRoot, "console.html"),
  // 打印渲染窗口（非 Vue 纯 TS 入口）：经 ESM 内联消费 @amdosion/vue3-print，取代旧 runtime.js。
  render: resolve(rendererRoot, "render.html"),
};

// 构建时 tools/build-renderer.js 逐窗口设置 VITE_WINDOW，每个窗口单独构建。
// 这样做不是因为 singlefile（已移除），而是为了窗口隔离：console 与 render 的依赖体积差异很大；
// 若改为单次 MPA 合并构建，公共 vendor chunk 可能把控制台依赖拖进打印渲染窗口，按需树摇白做。
// 逐窗口构建保证 render 入口不被控制台视图依赖污染。
// 未设置 VITE_WINDOW（如 dev server）时返回全部窗口。
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
  ],
  resolve: {
    alias: {
      "@": resolve(rendererRoot, "app"),
    },
  },
  build: {
    outDir: resolve(__dirname, "assets"),
    // 不清空 assets/：保留 print.html / loading.html / css/ / icons/ 等静态资源。
    // 生成产物（窗口 HTML + assets/assets/ 下的 chunk）的旧文件清理交给
    // tools/build-renderer.js 在构建前显式删除，避免内容哈希变更后残留陈旧 chunk。
    emptyOutDir: false,
    target: "es2020",
    rollupOptions: {
      // 逐窗口单入口构建（见 pickInput 注释）：未列出的窗口保留 assets/ 下的静态 HTML 不被覆盖。
      input: pickInput(),
    },
  },
});
