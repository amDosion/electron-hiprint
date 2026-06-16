// render 窗口运行时垫片：移植自旧 assets/render.html 的内联 shim。
//
// 必须在导入 @amdosion/vue3-print 之前求值——本模块在 render/main.ts 中作为第一条
// import 出现，ESM 按 import 顺序深度优先求值，故插件求值期 window 上的 jQuery 已就位
// （render 自身 DOM 代码用 $；与旧 render.html 先加载 jquery 的行为一致）。
//
// 注：旧页面还经 <script src> 注入 nzh/bwip-js/jsbarcode 全局，那是为喂给「外置依赖的
// 浏览器 IIFE runtime.js」。改为 ESM 后插件自带并经 import 解析这些依赖，不再读 window
// 全局，故此处不再设置它们（条码/大写金额渲染由插件内置副本完成）。
import $ from "jquery";
import vue3PrintCss from "@amdosion/vue3-print/dist/vue3-print.css?inline";
import printLockCss from "@amdosion/vue3-print/dist/print-lock.css?inline";

// 经 window-cast 赋值，避免厂商库各自的 Window 增强声明冲突。
const globalScope = (window as unknown) as Record<string, unknown>;
globalScope.$ = $;
globalScope.jQuery = $;

// 旧内联脚本：禁用插件自动 socket 连接，提供最小 process.env 垫片。
globalScope.autoConnect = false;
globalScope.io = () => undefined;
const runtimeProcess = (globalScope.process as {
  env?: Record<string, string | undefined>;
}) || { env: {} };
runtimeProcess.env = runtimeProcess.env || {};
runtimeProcess.env.NODE_ENV = runtimeProcess.env.NODE_ENV || "production";
globalScope.process = runtimeProcess;

// 插件样式：与旧 render.html 两条 <link> 语义一致——
// vue3-print.css 屏幕态常驻；print-lock.css 仅打印态(media="print")。
function injectStyle(css: string, media?: string): void {
  const style = document.createElement("style");
  if (media) {
    style.media = media;
  }
  style.textContent = css;
  document.head.appendChild(style);
}

injectStyle(vue3PrintCss);
injectStyle(printLockCss, "print");
