/*
 * @Date: 2024-12-14 23:59:49
 * @LastEditors: admin@54xavier.cn
 * @LastEditTime: 2024-12-15 02:55:48
 * @FilePath: /electron-hiprint/src/printlog.js
 */
"use strict";
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  dialog,
} = require("electron");
const dayjs = require("dayjs");
const path = require("path");
const db = require("../tools/database");
const { getAssetUrl } = require("./asset-url");
const { buildSafeLogQuery } = require("./log-query-guard");

function createPrintLogWindow() {
  const windowOptions = {
    width: 1080,
    height: 600,
    minWidth: 1040,
    minHeight: 550,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload/printLog.js"),
    },
  };

  // 创建打印日志窗口
  PRINT_LOG_WINDOW = new BrowserWindow(windowOptions);

  // 添加加载页面 解决白屏的问题
  loadingView(windowOptions);

  // 加载打印日志页面
  PRINT_LOG_WINDOW.loadURL(getAssetUrl("printLog.html"));

  // 未打包时打开开发者工具
  if (!app.isPackaged) {
    PRINT_LOG_WINDOW.webContents.openDevTools();
  }

  // 绑定窗口事件
  initPrintLogEvent();

  // 监听退出，移除所有事件
  PRINT_LOG_WINDOW.on("closed", removePrintLogEvent);

  return PRINT_LOG_WINDOW;
}

/**
 * @description: 加载等待页面，解决主窗口白屏问题
 * @param {Object} windowOptions 主窗口配置
 * @return {void}
 */
function loadingView(windowOptions) {
  const loadingContentView = new WebContentsView();
  PRINT_LOG_WINDOW.contentView.addChildView(loadingContentView);
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
    PRINT_LOG_WINDOW.contentView.removeChildView(loadingContentView);
  };

  // dom 加载完毕移除加载视图；加载失败也清理，避免 WebContents 泄漏
  PRINT_LOG_WINDOW.webContents.on("dom-ready", removeLoadingView);
  PRINT_LOG_WINDOW.webContents.on("did-fail-load", removeLoadingView);
}

/**
 * @description: 获取打印日志
 * @param {IpcMainEvent} event 事件
 * @param {Array} condition 搜索条件
 * @param {Array} params 搜索参数
 * @param {Object} page 分页
 * @param {Object} sort 排序
 * @param {Function} callback 回调函数
 * @return {void}
 */
function fetchPrintLogs(event, payload) {
  const baseQuery = `SELECT id, timestamp, socketId, clientType, printer, templateId, pageNum, status, rePrintAble, errorMessage FROM print_logs`;
  const totalQuery = `SELECT COUNT(*) AS total FROM print_logs`;

  // 渲染端通过 IPC 传入的 condition/page/sort 经守卫白名单校验后才拼接，
  // 杜绝任意 SQL 片段、列名注入，并保证 LIMIT/OFFSET 为整数。
  let safe;
  try {
    safe = buildSafeLogQuery(payload);
  } catch (error) {
    dialog.showMessageBox(PRINT_LOG_WINDOW, {
      type: "error",
      title: "错误",
      message: "查询条件非法，已拒绝执行",
      detail: error.message,
      noLink: true,
    });
    return;
  }

  const params = safe.params;
  const query = `${baseQuery}${safe.whereClause}${safe.orderBy} LIMIT ${safe.limit} OFFSET ${safe.offset}`;
  const total = `${totalQuery}${safe.whereClause}`;

  function allAsync(query, params) {
    return new Promise((resolve, reject) => {
      db.all(query, params, (err, rows) => {
        if (err) return reject(err);
        rows.forEach((row) => {
          row.timestamp = dayjs(row.timestamp)
            .add(8, "hour")
            .format("YYYY-MM-DD HH:mm:ss");
        });
        resolve(rows);
      });
    });
  }

  Promise.all([allAsync(query, params), allAsync(total, params)])
    .then(([rows, total]) => {
      event.sender.send("print-logs", {
        rows,
        total: total[0].total,
      });
    })
    .catch((err) => {
      dialog.showMessageBox(PRINT_LOG_WINDOW, {
        type: "error",
        title: "错误",
        message: "获取打印日志失败！",
        detail: err.message,
        noLink: true,
      });
    });
}

/**
 * @description: 清空打印日志
 * @param {IpcMainEvent} event 事件
 * @return {void}
 */
function clearPrintLogs(event) {
  db.run("DELETE FROM print_logs");
}

/**
 * @description: 重打打印
 * @param {IpcMainEvent}  event 事件
 * @param {Object} data 打印日志
 * @return {void}
 */
function rePrint(event, data) {
  // 校验入参：data 必须存在，且 data.id 必须为整数，否则直接拒绝。
  if (!data || !Number.isInteger(data.id)) {
    return;
  }

  db.get("SELECT * FROM print_logs WHERE id = ?", [data.id], (err, row) => {
    // 查询出错或记录不存在则直接返回，避免对 undefined 取属性。
    if (err || !row) {
      return;
    }

    // row.data 来自历史落库的 JSON 字符串，解析失败时记录并中止，不向窗口发送脏数据。
    let payload;
    try {
      payload = JSON.parse(row.data);
    } catch (parseError) {
      console.error("rePrint: 解析打印日志 data 失败", parseError);
      return;
    }

    // 打印窗口可能尚未创建或已关闭，发送前确认其存在。
    if (PRINT_WINDOW && PRINT_WINDOW.webContents) {
      PRINT_WINDOW.webContents.send("reprint", {
        ...payload,
        taskId: undefined,
        replyId: undefined,
        clientType: "local",
        socketId: undefined,
      });
    }
  });
}

/**
 * @description: 绑定打印日志窗口事件
 * @return {void}
 */
function initPrintLogEvent() {
  ipcMain.on("request-logs", fetchPrintLogs);
  ipcMain.on("reprint", rePrint);
  ipcMain.on("clear-logs", clearPrintLogs);
}

/**
 * @description: 移除所有事件
 * @return {void}
 */
function removePrintLogEvent() {
  ipcMain.removeListener("request-logs", fetchPrintLogs);
  ipcMain.removeListener("reprint", rePrint);
  ipcMain.removeListener("clear-logs", clearPrintLogs);
  PRINT_LOG_WINDOW = null;
}

module.exports = async () => {
  // 创建设置窗口
  await createPrintLogWindow();
};
