"use strict";

const fs = require("fs");
const { app, BrowserWindow, ipcMain, screen } = require("electron");
const path = require("path");
const { Jimp } = require("jimp");
const dayjs = require("dayjs");

const { getAssetUrl } = require("./asset-url");
const { store, getCurrentPrintStatusByName } = require("../tools/utils");
const { formatPrinterStatus } = require("./printer-status");
const { writePrintLog } = require("./print-log-writer");
const { completeRenderTask } = require("./runner-task");
const { resolvePrinterReadiness } = require("./printer-readiness-resolver");
const {
  resolvePrintPageSize,
  withResolvedPageSize,
} = require("./print-page-size");

// 这是 1920 * 1080 屏幕常规工作区域尺寸
let windowWorkArea = {
  width: 1920,
  height: 1032,
};

/**
 * @typedef {Object} CapturePageData 截图数据
 * @property {string} clientType socket 客户端类型  'local' | 'transit'
 * @property {string} socketId socket id
 * @property {string} replyId 中转回复 id
 * @property {string} templateId 模版 id
 * @property {string} taskId 任务 id
 * @property {number} x x坐标
 * @property {number} y y坐标
 * @property {number} width 宽度
 * @property {number} height 高度
 */

/**
 * @typedef {object} PageSize PDF 尺寸
 * @property {number} width 宽度
 * @property {number} height 高度
 */

/**
 * @typedef {object} Margins 边距
 * @property {number} top 上边距
 * @property {number} bottom 下边距
 * @property {number} left 左边距
 * @property {number} right 右边距
 */

/**
 * @typedef {Object} PrintToPDFData
 * @property {string} clientType socket 客户端类型  'local' | 'transit'
 * @property {string} socketId socket id
 * @property {string} replyId 中转回复 id
 * @property {string} templateId 模版 id
 * @property {string} taskId 任务 id
 * @property {boolean} landscape 网页是否应以横向模式打印 默认 true
 * @property {boolean} displayHeaderFooter 是否显示页眉和页脚 默认 false
 * @property {boolean} printBackground 是否打印背景图形 默认 false
 * @property {number} scale  网页渲染的比例 默认 1
 * @property {string | PageSize} pageSize 指定生成的 PDF 的页面大小 默认 Letter
 * @property {string | Margins} margins 边距
 * @property {string} pageRanges 要打印的页面范围 例如 '1-5, 8, 11-13'
 * @property {string} headerTemplate 打印标题的 HTML 模板
 * @property {string} footerTemplate 打印页脚的 HTML 模板
 * @property {number} preferCSSPageSize 是否优先使用 css 定义的页面大小
 */

/**
 * @description: 创建打印窗口
 * @return {BrowserWindow} RENDER_WINDOW 打印窗口
 */
async function createRenderWindow() {
  const windowOptions = {
    width: 300, // 窗口宽度
    height: 500, // 窗口高度
    show: false, // 不显示
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload/render.js"),
    },
    // 为窗口设置背景色可能优化字体模糊问题
    // https://www.electronjs.org/zh/docs/latest/faq#文字看起来很模糊这是什么原因造成的怎么解决这个问题呢
    backgroundColor: "#fff",
  };

  // 创建打印窗口
  RENDER_WINDOW = new BrowserWindow(windowOptions);

  // 加载打印渲染进程页面（经 app:// 加载：Vite 单文件内联 ESM 模块需真实 origin，
  // 复用 asset-protocol 的 net.fetch 流式伺服；插件已内联，不再注入外部 runtime.js）
  RENDER_WINDOW.webContents.loadURL(getAssetUrl("render.html"));

  RENDER_WINDOW.on("ready-to-show", () => {
    const windowBounds = RENDER_WINDOW.getBounds();
    const display = screen.getDisplayNearestPoint({
      x: windowBounds.x,
      y: windowBounds.y,
    });

    windowWorkArea = display.workAreaSize;

    // 未打包时打开开发者工具
    if (!app.isPackaged) {
      // !打开开发者模式时，窗口尺寸变化将在右上角显示窗口尺寸，对 capturePage 功能会造成一定的误解
      RENDER_WINDOW.webContents.openDevTools();
    }
  });

  // 绑定窗口事件
  initEvent();

  RENDER_WINDOW.on("closed", removeEvent);

  return RENDER_WINDOW;
}

/**
 * @description: 截图
 * @param {IpcMainEvent} event 事件
 * @param {CapturePageData} data 截图数据
 */
async function capturePage(event, data) {
  let socket = null;
  if (data.clientType === "local") {
    socket = SOCKET_SERVER.sockets.sockets.get(data.socketId);
  } else {
    socket = SOCKET_CLIENT;
  }
  // !在 win 上窗口可以超出屏幕尺寸，直接使用 webContents.capturePage api 截图没有问题
  // !在 mac 上窗口不能超出屏幕尺寸，需要一点儿点儿截图最后拼接
  try {
    let images = [];

    // 打印元素宽度
    const printWidth = Math.ceil(data.width);
    // 打印元素高度
    const printHeight = Math.ceil(data.height);

    // 窗口内容区域宽度
    let innerWidth = await RENDER_WINDOW.webContents.executeJavaScript(
      "window.innerWidth",
    );
    innerWidth = Math.ceil(innerWidth);

    // 窗口内容区域高度
    let innerHeight = await RENDER_WINDOW.webContents.executeJavaScript(
      "window.innerHeight",
    );
    innerHeight = Math.ceil(innerHeight);

    // 元素高度与窗口高度获取最小值，如果窗口比元素小
    const height = Math.min(printHeight, innerHeight);

    // 将窗口移至屏幕左上角
    RENDER_WINDOW.setBounds({
      x: 0,
      y: 0,
    });
    // 设置内容区大小
    RENDER_WINDOW.setContentSize(printWidth, height, false);

    const captureOptions = {
      x: 0,
      y: 0,
      width: printWidth,
      height,
    };

    // 截取首图
    const nativeImage = await RENDER_WINDOW.webContents.capturePage(
      captureOptions,
    );
    // 有说法 toJPEG 性能比 toPNG 更高
    images.push(nativeImage.resize({ width: printWidth }).toJPEG(100));

    // 截取剩余图
    for (let offset = height; offset < data.height; offset += height) {
      await RENDER_WINDOW.webContents.executeJavaScript(
        `window.scrollTo(0, ${offset})`,
        false,
      );

      // 等待滚动完成
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 计算最后一页需要截取的高度（最后一页可能不足一屏，取剩余内容高度）
      captureOptions.height = Math.min(height, data.height - offset);

      const image = await RENDER_WINDOW.webContents.capturePage(captureOptions);
      // 有说法 toJPEG 性能比 toPNG 更高
      images.push(image.resize({ width: printWidth }).toJPEG(100));
    }

    // 使用 jimp 拼接图片
    const result = new Jimp({ width: printWidth, height: printHeight });

    for (let idx = 0; idx < images.length; idx++) {
      const jimpImg = await Jimp.fromBuffer(images[idx]);
      result.composite(jimpImg, 0, idx * height);
    }

    // await 截图缓冲：纳入 try/catch，失败回传 render-jpeg-error；
    // 且在 emit 完成后才进入 finally 释放 runner，避免 RENDER_WINDOW 被下一任务并发复用
    const buffer = await result.getBuffer("image/jpeg", {
      quality: 100,
    });
    // 未打包调试模式下将图片保存到桌面
    if (!app.isPackaged) {
      fs.writeFile(
        path.join(
          app.getPath("desktop"),
          `capture_${dayjs().format("YYYY-MM-DD HH_mm_ss")}.png`,
        ),
        buffer,
        () => {},
      );
    }
    console.log(
      `${data.replyId ? "中转服务" : "插件端"} ${socket?.id} 模版 【${
        data.templateId
      }】 获取 png 成功`,
    );
    // 成功分支与失败分支(234)对齐空值守卫：截图期间本地 socket 瞬断时 socket 为 undefined，
    // 直接 emit 会抛 TypeError 并被误记为失败；守卫后静默跳过（无对端可收）。
    socket &&
      socket.emit("render-jpeg-success", {
        msg: `获取 jpeg 成功`,
        templateId: data.templateId,
        buffer,
        replyId: data.replyId,
      });
  } catch (error) {
    console.log(
      `${data.replyId ? "中转服务" : "插件端"} ${socket?.id} 模版 【${
        data.templateId
      }】 获取 png 失败`,
    );
    socket &&
      socket.emit("render-jpeg-error", {
        msg: `获取 png 失败`,
        templateId: data.templateId,
        replyId: data.replyId,
      });
  } finally {
    completeRenderTask(data, { doneMap: RENDER_RUNNER_DONE });
  }
}

/**
 * @description: 打印到PDF
 * @param {IpcMainEvent} event 事件
 * @param {PrintToPDFData} data 打印数据
 */
async function printToPDF(event, data) {
  let socket = null;
  if (data.clientType === "local") {
    socket = SOCKET_SERVER.sockets.sockets.get(data.socketId);
  } else {
    socket = SOCKET_CLIENT;
  }
  const effectivePageSize = await resolvePrintPageSize(
    RENDER_WINDOW.webContents,
    data,
  );
  const printData = withResolvedPageSize(data, effectivePageSize);
  RENDER_WINDOW.webContents
    .printToPDF({
      landscape: printData.landscape ?? false, // 横向打印
      displayHeaderFooter: printData.displayHeaderFooter ?? false, // 显示页眉页脚
      printBackground: printData.printBackground ?? true, // 打印背景色
      scale: printData.scale ?? 1, // 渲染比例 默认 1
      pageSize: printData.pageSize,
      margins: printData.margins, // 边距
      pageRanges: printData.pageRanges, // 打印页数范围
      headerTemplate: printData.headerTemplate, // 页头模板 (html)
      footerTemplate: printData.footerTemplate, // 页脚模板 (html)
      preferCSSPageSize: printData.preferCSSPageSize ?? false,
    })
    .then((buffer) => {
      // 未打包调试模式下将pdf保存到桌面
      if (!app.isPackaged) {
        fs.writeFile(
          path.join(
            app.getPath("desktop"),
            `pdf_${dayjs().format("YYYY-MM-DD HH_mm_ss")}.pdf`,
          ),
          buffer,
          () => {},
        );
      }
      // 成功分支与失败分支(295)对齐空值守卫：渲染期间 socket 瞬断时为 undefined，
      // 直接 emit 会抛 TypeError 并把成功误记为失败；守卫后静默跳过（无对端可收）。
      socket &&
        socket.emit("render-pdf-success", {
          templateId: data.templateId,
          buffer,
          replyId: data.replyId,
        });
    })
    .catch((error) => {
      console.log(
        `${data.replyId ? "中转服务" : "插件端"} ${socket?.id} 模版 【${
          data.templateId
        }】 获取 pdf 失败`,
      );
      socket &&
        socket.emit("render-pdf-error", {
          msg: `获取 pdf 失败`,
          templateId: data.templateId,
          replyId: data.replyId,
        });
    })
    .finally(() => {
      completeRenderTask(data, { doneMap: RENDER_RUNNER_DONE });
    });
}

/**
 * @description: 打印
 * @param {IpcMainEvent} event 事件
 * @param {object} data 打印数据
 *
 * */
async function printFun(event, data) {
  let socket = null;
  if (data.clientType === "local") {
    socket = SOCKET_SERVER.sockets.sockets.get(data.socketId);
  } else {
    socket = SOCKET_CLIENT;
  }
  const { readiness, deviceName } = await resolvePrinterReadiness({
    webContents: RENDER_WINDOW.webContents,
    data,
    store,
    getStatusByName: getCurrentPrintStatusByName,
  });

  const logPrintResult = (status, errorMessage = "") => {
    writePrintLog({
      socketId: socket?.id,
      clientType: data.clientType,
      printer: deviceName,
      templateId: data.templateId,
      data,
      pageNum: data.pageNum,
      status,
      rePrintAble: data.rePrintAble,
      errorMessage,
    });
  };

  if (!readiness.ready) {
    const statusText = formatPrinterStatus(readiness);
    console.log(
      `${data.replyId ? "中转服务" : "插件端"} ${socket?.id} 模板 【${
        data.templateId
      }】 打印失败，打印机异常，打印机：${deviceName}，打印机状态：${statusText}`,
    );
    logPrintResult("failed", `打印机异常：${statusText}`);
    socket &&
      socket.emit("render-print-error", {
        msg: deviceName + "打印机异常",
        templateId: data.templateId,
        replyId: data.replyId,
      });
    completeRenderTask(data, { doneMap: RENDER_RUNNER_DONE });
    return;
  }

  const effectivePageSize = await resolvePrintPageSize(
    RENDER_WINDOW.webContents,
    data,
  );
  const printData = withResolvedPageSize(data, effectivePageSize);

  // 打印 详见https://www.electronjs.org/zh/docs/latest/api/web-contents
  RENDER_WINDOW.webContents.print(
    {
      silent: printData.silent ?? true, // 静默打印
      printBackground: printData.printBackground ?? true, // 是否打印背景
      deviceName: deviceName, // 打印机名称
      color: printData.color ?? true, // 是否打印颜色
      margins: printData.margins ?? {
        marginType: "none",
      }, // 边距
      landscape: printData.landscape ?? false, // 是否横向打印
      scaleFactor: printData.scaleFactor ?? 100, // 打印缩放比例
      pagesPerSheet: printData.pagesPerSheet ?? 1, // 每张纸的页数
      collate: printData.collate ?? true, // 是否排序
      copies: printData.copies ?? 1, // 打印份数
      pageRanges: printData.pageRanges ?? {}, // 打印页数
      duplexMode: printData.duplexMode, // 打印模式 simplex,shortEdge,longEdge
      dpi: printData.dpi ?? 300, // 打印机DPI
      header: printData.header, // 打印头
      footer: printData.footer, // 打印尾
      pageSize: printData.pageSize, // 打印纸张
    },
    (success, failureReason) => {
      if (socket) {
        if (success) {
          console.log(
            `${data.replyId ? "中转服务" : "插件端"} ${socket?.id} 模板 【${
              data.templateId
            }】 打印成功，打印类型 JSON，打印机：${deviceName}，页数：${
              data.pageNum
            }`,
          );
          const result = {
            msg: "打印成功",
            templateId: data.templateId,
            replyId: data.replyId,
          };
          logPrintResult("success");
          socket.emit("render-print-success", result);
        } else {
          console.log(
            `${data.replyId ? "中转服务" : "插件端"} ${socket?.id} 模板 【${
              data.templateId
            }】 打印失败，打印类型 JSON，打印机：${deviceName}，原因：${failureReason}`,
          );
          logPrintResult("failed", failureReason);
          socket.emit("render-print-error", {
            msg: failureReason,
            templateId: data.templateId,
            replyId: data.replyId,
          });
        }
      }
      completeRenderTask(data, { doneMap: RENDER_RUNNER_DONE });
    },
  );
}

/**
 * @description: 初始化事件
 */
function initEvent() {
  ipcMain.on("capturePage", capturePage);
  ipcMain.on("printToPDF", printToPDF);
  ipcMain.on("print", printFun);
}

/**
 * @description: 移除事件
 * @return {void}
 */
function removeEvent() {
  ipcMain.removeListener("capturePage", capturePage);
  ipcMain.removeListener("printToPDF", printToPDF);
  ipcMain.removeListener("print", printFun);
  RENDER_WINDOW = null;
}

module.exports = async () => {
  // 创建渲染窗口
  await createRenderWindow();
};
