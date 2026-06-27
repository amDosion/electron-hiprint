"use strict";
const { app, BrowserWindow, dialog } = require("electron");
const { getAppWindow, destroyConsole } = require("./app-window");

/**
 * 退出应用
 *
 * @return {undefined}
 */
exports.appQuit = function() {
  console.log("==> Electron-hiprint 关闭 <==");
  destroyConsole();
  PRINT_WINDOW && PRINT_WINDOW.destroy();
  APP_TRAY && APP_TRAY.destroy();
  app.quit();
};

/**
 * @description: 统一的弹出消息框处理（合并设置视图 / 打印渲染路径原各自注册的同名监听，避免重复弹框）
 *   按来源窗口解析父窗口：优先用消息来源窗口本身；来源为空或不可见（如隐藏的 RENDER_WINDOW）时，
 *   回退到控制台窗口（getAppWindow()）。解析到父窗口则以模态方式挂在其上，否则无父弹出。
 * @param {IpcMainEvent} event
 * @param {Object} data https://www.electronjs.org/zh/docs/latest/api/dialog#dialogshowmessageboxbrowserwindow-options
 * @return {void}
 */
exports.showMessageBox = function(event, data) {
  let parent = null;

  // 解析消息来源窗口
  const sourceWindow =
    event && event.sender ? BrowserWindow.fromWebContents(event.sender) : null;

  if (sourceWindow && !sourceWindow.isDestroyed() && sourceWindow.isVisible()) {
    parent = sourceWindow;
  } else {
    // 来源为空或不可见：回退到控制台窗口
    const appWin = getAppWindow();
    if (appWin && !appWin.isDestroyed()) parent = appWin;
  }

  if (parent) {
    dialog.showMessageBox(parent, { noLink: true, ...data });
  } else {
    dialog.showMessageBox({ noLink: true, ...data });
  }
};
