"use strict";
const { app, BrowserWindow, dialog } = require("electron");

/**
 * 退出应用
 *
 * @return {undefined}
 */
exports.appQuit = function() {
  console.log("==> Electron-hiprint 关闭 <==");
  SET_WINDOW && SET_WINDOW.destroy();
  PRINT_WINDOW && PRINT_WINDOW.destroy();
  MAIN_WINDOW && MAIN_WINDOW.destroy();
  APP_TRAY && APP_TRAY.destroy();
  app.quit();
};

/**
 * @description: 统一的弹出消息框处理（合并 set.js / render.js 原各自注册的同名监听，避免重复弹框）
 *   按来源窗口解析父窗口：优先用消息来源窗口本身；来源为空或不可见（如隐藏的 RENDER_WINDOW）时，
 *   回退到可见的 SET_WINDOW，否则回退 MAIN_WINDOW。解析到父窗口则以模态方式挂在其上，否则无父弹出。
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
  } else if (
    SET_WINDOW &&
    !SET_WINDOW.isDestroyed() &&
    SET_WINDOW.isVisible()
  ) {
    // 来源为空或不可见（如隐藏的 RENDER_WINDOW）：回退到可见的设置窗口
    parent = SET_WINDOW;
  } else if (MAIN_WINDOW && !MAIN_WINDOW.isDestroyed()) {
    // 再回退主窗口
    parent = MAIN_WINDOW;
  }

  if (parent) {
    dialog.showMessageBox(parent, { noLink: true, ...data });
  } else {
    dialog.showMessageBox({ noLink: true, ...data });
  }
};
