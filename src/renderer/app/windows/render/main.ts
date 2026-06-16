// render 窗口入口（移植自旧 assets/render.html 内联脚本）。
//
// 插件加载：经 Vite 内联消费 @amdosion/vue3-print 的**函数式 ./print 子入口**
// （getPrintHtml，jQuery-free 渲染路径）。取代两段历史：①旧页面注入外部
// {version}_vue3-print.runtime.js + 读 window.Vue3Print 全局；②早前临时走的 `.` 全量
// 门面（只用一个 getHtml 却拖入 designer/socket/pinia/vue/i18n 等死重，render.html 3.65MB）。
// 渲染逻辑、与主进程的 IPC 契约（监听 png/pdf/print，回送 capturePage/printToPDF/print
// 及其数据形态）保持不变。
import "./globals-setup";
import $ from "jquery";
import { getPrintHtml } from "@amdosion/vue3-print/print";
import { requireBridge } from "@/shared/bridge";

type PrintTemplateArg = Parameters<typeof getPrintHtml>[0];
type PrintHtmlOptions = NonNullable<Parameters<typeof getPrintHtml>[1]>;

const ipc = requireBridge(
  window.hiprintRender,
  "hiprintRender",
  "preload/render.js",
);

// 引擎缺失即明确报错（取代旧页面"全局未暴露 hiprint"分支）。
if (typeof getPrintHtml !== "function") {
  ipc.send("showMessageBox", {
    title: "插件加载错误",
    message:
      "@amdosion/vue3-print/print 未暴露 getPrintHtml 渲染函数，请升级客户端或重新启动后重试！",
    type: "error",
    buttons: ["我知道了"],
  });
}

// 模板 json：string 或 object 统一处理（移植自旧 render.html getTemplateJson）。
function getTemplateJson(val: unknown): Record<string, unknown> | undefined {
  try {
    let template: unknown = val;
    if ("string" === typeof template) {
      template = JSON.parse(template);
    }
    if ("object" !== typeof template || template === null) {
      throw new Error("模板格式错误");
    }
    const panels = (template as { panels?: unknown[] }).panels;
    if (panels && panels.length === 0) {
      throw new Error("模板格式错误");
    }
    return template as Record<string, unknown>;
  } catch {
    ipc.send("showMessageBox", {
      title: "模板格式错误",
      message: "请传入正确的模板json",
      type: "error",
      buttons: ["我知道了"],
    });
    return undefined;
  }
}

function sanitizeNode(root: DocumentFragment): void {
  root.querySelectorAll("script").forEach((node) => node.remove());
  // 移除 SVG <foreignObject>（可内嵌任意可执行 HTML）
  root.querySelectorAll("foreignObject").forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((node) => {
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name;
      // 移除事件处理属性
      if (/^on/i.test(name)) {
        node.removeAttribute(name);
        return;
      }
      // 移除 javascript: 协议的 href/src/xlink:href 等属性
      const value = (attribute.value || "")
        .replace(/[\x00-\x20]+/g, "")
        .toLowerCase();
      if (
        /^(href|xlink:href|src|action|formaction|data|background)$/i.test(
          name,
        ) &&
        value.startsWith("javascript:")
      ) {
        node.removeAttribute(name);
      }
    });
  });
}

function normalizeHtmlContent(html: unknown): string {
  if (html && (html as { jquery?: unknown }).jquery) {
    return Array.from(html as ArrayLike<Element>)
      .map((node) => node.outerHTML || "")
      .join("");
  }
  if (Array.isArray(html)) {
    return html.map((item) => normalizeHtmlContent(item)).join("");
  }
  if (html && (html as { outerHTML?: string }).outerHTML) {
    return (html as { outerHTML: string }).outerHTML;
  }
  return String(html || "");
}

function setPrintElementContent(html: unknown): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = normalizeHtmlContent(html);
  sanitizeNode(template.content);
  const printElement = document.getElementById("printElement") as HTMLElement;
  printElement.replaceChildren(...Array.from(template.content.childNodes));
  return printElement;
}

// 模板 json → 打印 HTML。函数式 ./print 的 getPrintHtml 与旧 PrintTemplate.getHtml
// 共用同一字符串渲染器（见包内 print-template.d.ts:255-259 注释），输出等价、行为不变。
// png 链路历史上传入裸 data.template（可能是字符串），此处统一兼容字符串/对象。
function renderTemplateHtml(template: unknown, data: unknown): string {
  const json = typeof template === "string" ? JSON.parse(template) : template;
  return getPrintHtml(json as PrintTemplateArg, {
    data: data as PrintHtmlOptions["data"],
  });
}

// 旧页面 `templateId: data.templateId || template.id` 的兜底 id 来自 PrintTemplate 实例的
// 自生成 uuid（仅作回送相关 id，主进程不依赖其语义）。函数式渲染无实例，调用方未带
// templateId 时用 crypto.randomUUID() 生成同等的一次性兜底 id。
function currentTemplateId(data: RenderTaskData): string | undefined {
  return data.templateId || crypto.randomUUID();
}

ipc.on("png", (data) => {
  // 滚动窗口滚动条到左上角
  window.scrollTo(0, 0);
  let html = data.html;
  if (data.template) {
    html = renderTemplateHtml(data.template, data.data);
  }
  const printElement = $(setPrintElementContent(html));
  const rects = (Array.from(
    printElement.find(".hiprint-printPaper"),
  ) as Element[]).map((el) => el.getBoundingClientRect());
  const capturePageData = {
    ...data,
    templateId: currentTemplateId(data),
    x: rects[0].x,
    y: rects[0].y,
    width: rects[0].width,
    height: rects[rects.length - 1].bottom,
  };
  setTimeout(() => {
    ipc.send("capturePage", capturePageData);
  });
});

ipc.on("pdf", (data) => {
  let html = data.html;
  if (data.template) {
    const template = getTemplateJson(data.template);
    html = renderTemplateHtml(template, data.data);
  }
  setPrintElementContent(html);
  setTimeout(() => {
    ipc.send("printToPDF", {
      ...data,
      templateId: currentTemplateId(data),
    });
  });
});

ipc.on("print", (data) => {
  let html = data.html;
  if (data.template) {
    const template = getTemplateJson(data.template);
    html = renderTemplateHtml(template, data.data);
  }
  const printElement = setPrintElementContent(html);
  setTimeout(() => {
    ipc.send("print", {
      ...data,
      html: printElement.firstElementChild
        ? printElement.firstElementChild.innerHTML
        : printElement.innerHTML,
      templateId: currentTemplateId(data),
      pageNum: $("#printElement .hiprint-printPaper").length,
    });
  });
});
