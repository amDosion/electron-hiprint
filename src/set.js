/*
 * @Date: 2023-09-05 17:34:28
 * @LastEditors: admin@54xavier.cn
 * @LastEditTime: 2024-12-22 16:50:24
 * @FilePath: \xavier9896-electron-hiprint\src\set.js
 */
"use strict";

const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const fs = require("node:fs");
const { store } = require("../tools/utils");
const { getAssetUrl } = require("./asset-url");
const helper = require("./helper");

/**
 * @description: 创建设置窗口
 * @return {BrowserWindow} SET_WINDOW 设置窗口
 */
async function createSetWindow() {
  const windowOptions = {
    width: 440, // 窗口宽度
    height: 591, // 窗口高度
    title: "设置",
    useContentSize: true, // 窗口大小不包含边框
    center: true, // 居中
    alwaysOnTop: true, // 永远置顶
    resizable: false, // 不可缩放
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload/set.js"),
    },
  };

  // 创建设置窗口
  SET_WINDOW = new BrowserWindow(windowOptions);

  // 添加加载页面 解决白屏的问题
  loadingView(windowOptions);

  // 加载设置渲染进程页面
  SET_WINDOW.webContents.loadURL(getAssetUrl("set.html"));

  // 未打包时打开开发者工具
  if (!app.isPackaged) {
    SET_WINDOW.webContents.openDevTools();
  }

  // 绑定窗口事件
  initSetEvent();

  // 监听退出，移除所有事件
  SET_WINDOW.on("closed", removeEvent);

  return SET_WINDOW;
}

/**
 * @description: 加载等待页面，解决主窗口白屏问题
 * @param {Object} windowOptions 主窗口配置
 * @return {void}
 */
function loadingView(windowOptions) {
  const loadingContentView = new WebContentsView();
  SET_WINDOW.contentView.addChildView(loadingContentView);
  loadingContentView.setBounds({
    x: 0,
    y: 0,
    width: windowOptions.width,
    height: windowOptions.height,
  });

  loadingContentView.webContents.loadURL(getAssetUrl("loading.html"));

  const removeLoadingView = () => {
    if (
      loadingContentView.webContents &&
      !loadingContentView.webContents.isDestroyed()
    ) {
      loadingContentView.webContents.destroy();
    }
    SET_WINDOW.contentView.removeChildView(loadingContentView);
  };

  // dom 加载完毕移除加载视图；加载失败也清理，避免 WebContents 泄漏
  SET_WINDOW.webContents.on("dom-ready", removeLoadingView);
  SET_WINDOW.webContents.on("did-fail-load", removeLoadingView);
}

/**
 * @description: 渲染进程触发写入配置
 * @param {IpcMainEvent} event
 * @param {Object} data 配置数据
 * @return {void}
 */
function setConfig(event, data) {
  console.log("==> 设置窗口：保存配置 <==");
  // 保存配置前，弹出 dialog 确认
  dialog
    .showMessageBox(SET_WINDOW, {
      type: "question",
      title: "提示",
      message:
        "保存设置需要重启软件，如有正在执行中的打印任务可能会被中断，是否确定要保存并重启？",
      buttons: ["确定", "取消"],
    })
    .then((res) => {
      if (res.response === 0) {
        try {
          let pdfPath = path.join(data.pdfPath, "url_pdf");
          fs.mkdirSync(pdfPath, { recursive: true });
          pdfPath = path.join(data.pdfPath, "blob_pdf");
          fs.mkdirSync(pdfPath, { recursive: true });
          pdfPath = path.join(data.pdfPath, "hiprint");
          fs.mkdirSync(pdfPath, { recursive: true });
        } catch {
          dialog.showMessageBox(SET_WINDOW, {
            type: "error",
            title: "提示",
            message: "pdf 保存路径无法写入数据，请重新设置！",
            buttons: ["确定"],
            noLink: true,
          });
          return;
        }
        try {
          fs.accessSync(data.logPath, fs.constants.W_OK);
        } catch (err) {
          dialog.showMessageBox(SET_WINDOW, {
            type: "error",
            title: "提示",
            message: "日志保存路径无法写入数据，请重新设置！",
            buttons: ["确定"],
            noLink: true,
          });
          return;
        }
        if (data.exportDirectory && data.exportDirectory.enabled) {
          try {
            fs.accessSync(data.exportDirectory.path, fs.constants.W_OK);
          } catch (err) {
            dialog.showMessageBox(SET_WINDOW, {
              type: "error",
              title: "提示",
              message: "共享导出目录无法写入数据，请重新设置！",
              buttons: ["确定"],
              noLink: true,
            });
            return;
          }
        }
        store.set(data);
        setTimeout(() => {
          app.relaunch();
          app.exit();
        }, 500);
      }
    });
}

/**
 * @description: 渲染进程触发设置工作区大小
 * @param {IpcMainEvent} event
 * @param {Object} data {width, height[, animate]}
 * @return {void}
 */
function setContentSize(event, data) {
  SET_WINDOW.setContentSize(data.width, data.height, data.animate ?? true);
}

/**
 * @description: 渲染进程触发选择目录
 * @param {IpcMainEvent} event
 * @param {Object} data https://www.electronjs.org/zh/docs/latest/api/dialog#dialogshowopendialogbrowserwindow-options
 * @return {void}
 */
function showOpenDialog(event, data) {
  dialog.showOpenDialog(SET_WINDOW, data).then((result) => {
    if (!result.canceled) {
      try {
        fs.accessSync(result.filePaths[0], fs.constants.W_OK);
      } catch {
        dialog.showMessageBox(SET_WINDOW, {
          type: "error",
          title: "提示",
          message: "路径无法写入，请重新选择！",
          buttons: ["确定"],
          noLink: true,
        });
        result.canceled = true;
      }
    }
    event.reply("openDialog", result);
  });
}

/**
 * @description: 渲染进程触发打开目录
 * @param {IpcMainEvent} event
 * @param {Object} data 目录路径
 * @return {void}
 */
function openDirectory(event, data) {
  // 仅允许打开真实存在的目录：shell.openPath 对文件会按关联程序执行（Windows 上
  // .exe/.bat 会被运行），这里限定为目录，避免渲染端传入可执行文件路径被执行。
  try {
    if (typeof data === "string" && fs.statSync(data).isDirectory()) {
      shell.openPath(data);
    }
  } catch (error) {
    console.log("openDirectory 拒绝非目录路径:", error?.message);
  }
}

/**
 * @description: 渲染进程触发测试连接中转服务
 * @param {IpcMainEvent} event
 * @param {Object} data {url, token}
 * @return {void}
 */
function testTransit(event, data) {
  const { io } = require("socket.io-client");
  const socket = io(data.url, {
    transports: ["websocket"],
    reconnection: false, // 关闭自动重连
    query: {
      test: true, // 标识为测试连通性
    },
    auth: {
      token: data.token, // 身份令牌
    },
  });

  // 连接错误
  socket.on("connect_error", (err) => {
    dialog.showMessageBox(SET_WINDOW, {
      type: "error",
      title: "提示",
      message: `${err.message}，请检查设置！`,
      buttons: ["确定"],
      noLink: true,
    });
    socket.close();
  });

  // 连接成功
  socket.on("connect", () => {
    dialog.showMessageBox(SET_WINDOW, {
      type: "info",
      title: "提示",
      message: "连接成功！",
      buttons: ["确定"],
      noLink: true,
    });
  });

  // 中转服务信息
  socket.on("serverInfo", (data) => {
    // TODO: 根据服务器返回信息判断服务器是否满足连接条件
    // {
    //   version: '0.0.4', // 中转服务版本号
    //   currentClients: 1, // 当前 token client 连接数
    //   allClients: 1, // 所有 token client 连接数
    //   webClients: 1, // web client 连接数
    //   allWebClients: 1, // 所有 web client 连接数
    //   totalmem: 17179869184, // 总内存
    //   freemem: 94961664, // 可用内存
    // }

    // 关闭测试连接
    socket.close();
  });
}

/**
 * @description: 关闭设置窗口
 * @return {void}
 */
function closeSetWindow() {
  SET_WINDOW && SET_WINDOW.close();
}

/**
 * @description: 绑定设置窗口事件
 * @return {void}
 */
function initSetEvent() {
  ipcMain.on("setConfig", setConfig);
  ipcMain.on("setContentSize", setContentSize);
  ipcMain.on("showOpenDialog", showOpenDialog);
  ipcMain.on("openDirectory", openDirectory);
  ipcMain.on("testTransit", testTransit);
  ipcMain.on("closeSetWindow", closeSetWindow);
  ipcMain.on("getPrintersList", getPrintersList);
}

/**
 * @description: 移除所有事件
 * @return {void}
 */
function removeEvent() {
  ipcMain.removeListener("setConfig", setConfig);
  ipcMain.removeListener("setContentSize", setContentSize);
  ipcMain.removeListener("showOpenDialog", showOpenDialog);
  ipcMain.removeListener("openDirectory", openDirectory);
  ipcMain.removeListener("testTransit", testTransit);
  ipcMain.removeListener("closeSetWindow", closeSetWindow);
  ipcMain.removeListener("getPrintersList", getPrintersList);
  SET_WINDOW = null;
}

/**
 * @description: 获取打印机列表并发送给渲染进程
 * @param {IpcMainEvent} event
 * @return {void}
 */
async function getPrintersList(event) {
  try {
    const printers = await SET_WINDOW.webContents.getPrintersAsync();
    let list = printers.map((item) => {
      return { value: item.name };
    });
    SET_WINDOW.webContents.send("getPrintersList", list);
  } catch (error) {
    console.error("获取打印机列表失败:", error);
    SET_WINDOW.webContents.send("getPrintersList", []);
  }
}

module.exports = async () => {
  // 创建设置窗口
  await createSetWindow();
};
