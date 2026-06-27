"use strict";
const {
  app,
  ipcMain,
  dialog,
  shell,
  clipboard,
  Notification,
} = require("electron");
const path = require("path");
const fs = require("node:fs");
const dayjs = require("dayjs");
const { store, address, emitConnectionStatus, getMachineId } = require("../tools/utils");
const db = require("../tools/database");
const { buildSafeLogQuery } = require("./log-query-guard");
const softwareLogStore = require("./software-log-store");
const helper = require("./helper");
const { getAppWindow } = require("./app-window");
const { showConsole } = require("./app-window");

// ---- set 业务 ----

/**
 * @description: 渲染进程触发写入配置（relaunch 逻辑不变）
 */
function setConfig(event, data) {
  console.log("==> 设置窗口：保存配置 <==");
  const nextData = { ...data };
  delete nextData.logPath;
  dialog
    .showMessageBox(getAppWindow(), {
      type: "question",
      title: "提示",
      message:
        "保存设置需要重启软件，如有正在执行中的打印任务可能会被中断，是否确定要保存并重启？",
      buttons: ["确定", "取消"],
    })
    .then((res) => {
      if (res.response === 0) {
        try {
          let pdfPath = path.join(nextData.pdfPath, "url_pdf");
          fs.mkdirSync(pdfPath, { recursive: true });
          pdfPath = path.join(nextData.pdfPath, "blob_pdf");
          fs.mkdirSync(pdfPath, { recursive: true });
          pdfPath = path.join(nextData.pdfPath, "hiprint");
          fs.mkdirSync(pdfPath, { recursive: true });
        } catch {
          dialog.showMessageBox(getAppWindow(), {
            type: "error",
            title: "提示",
            message: "pdf 保存路径无法写入数据，请重新设置！",
            buttons: ["确定"],
            noLink: true,
          });
          return;
        }
        if (nextData.exportDirectory && nextData.exportDirectory.enabled) {
          try {
            fs.accessSync(nextData.exportDirectory.path, fs.constants.W_OK);
          } catch (err) {
            dialog.showMessageBox(getAppWindow(), {
              type: "error",
              title: "提示",
              message: "共享导出目录无法写入数据，请重新设置！",
              buttons: ["确定"],
              noLink: true,
            });
            return;
          }
        }
        store.set(nextData);
        setTimeout(() => {
          app.relaunch();
          app.exit();
        }, 500);
      }
    });
}

/**
 * @description: 渲染进程触发选择目录
 */
function showOpenDialog(event, data) {
  dialog.showOpenDialog(getAppWindow(), data).then((result) => {
    if (!result.canceled) {
      try {
        fs.accessSync(result.filePaths[0], fs.constants.W_OK);
      } catch {
        dialog.showMessageBox(getAppWindow(), {
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
 */
function testTransit(event, data) {
  const { io } = require("socket.io-client");
  const socket = io(data.url, {
    transports: ["websocket"],
    reconnection: false,
    query: { test: true },
    auth: { token: data.token },
  });

  let settled = false;
  const finish = (type, message) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try { socket.close(); } catch { /* 关闭异常忽略 */ }
    if (!event.sender.isDestroyed()) {
      event.reply("testTransitResult", { type, message });
    }
  };

  const timer = setTimeout(() => {
    finish("error", "连接超时，请检查地址与网络后重试！");
  }, 10000);

  socket.on("connect_error", (err) => {
    finish("error", `${err.message}，请检查设置！`);
  });
  socket.on("connect", () => {
    finish("success", "连接成功！");
  });
}

/**
 * @description: 获取打印机列表并发送给渲染进程
 */
async function getPrintersList(event) {
  const win = getAppWindow();
  try {
    const printers = await win.webContents.getPrintersAsync();
    const list = printers.map((item) => ({ value: item.name }));
    win.webContents.send("getPrintersList", list);
  } catch (error) {
    console.error("获取打印机列表失败:", error);
    win.webContents.send("getPrintersList", []);
  }
}

// ---- printLog 业务 ----

/**
 * @description: 获取打印日志
 */
function fetchPrintLogs(event, payload) {
  const baseQuery = `SELECT id, timestamp, socketId, clientType, printer, templateId, pageNum, status, rePrintAble, errorMessage FROM print_logs`;
  const totalQuery = `SELECT COUNT(*) AS total FROM print_logs`;

  let safe;
  try {
    safe = buildSafeLogQuery(payload);
  } catch (error) {
    dialog.showMessageBox(getAppWindow(), {
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

  function allAsync(q, p) {
    return new Promise((resolve, reject) => {
      db.all(q, p, (err, rows) => {
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
    .then(([rows, totalRows]) => {
      event.sender.send("print-logs", {
        rows,
        total: totalRows[0].total,
      });
    })
    .catch((err) => {
      dialog.showMessageBox(getAppWindow(), {
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
 */
function clearPrintLogs(event) {
  db.run("DELETE FROM print_logs");
}

/**
 * @description: 重打打印（仍发给 PRINT_WINDOW，render 离屏打印窗口不动）
 */
function rePrint(event, data) {
  if (!data || !Number.isInteger(data.id)) return;

  db.get("SELECT * FROM print_logs WHERE id = ?", [data.id], (err, row) => {
    if (err || !row) return;

    let payload;
    try {
      payload = JSON.parse(row.data);
    } catch (parseError) {
      console.error("rePrint: 解析打印日志 data 失败", parseError);
      return;
    }

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

// ---- softwareLog 业务 ----

/**
 * @description: 打开 sqlite 数据库目录
 */
function openFolder() {
  shell.openPath(path.dirname(softwareLogStore.getDatabasePath()));
}

// ---- index 侧（原在 main.js 的 IPC）----

/**
 * @description: 允许渲染进程创建通知
 */
function handleNotification(event, data) {
  const notification = new Notification(data);
  notification.show();
}

/**
 * @description: 获取设备唯一 id
 */
function handleGetMachineId(event) {
  const machineId = getMachineId();
  event.sender.send("machineId", machineId);
}

/**
 * @description: 获取设备 ip、mac 等信息
 */
function handleGetAddress(event) {
  address.all().then((obj) => {
    const bindHost = store.get("bindHost") || "127.0.0.1";
    const clientHost =
      bindHost === "0.0.0.0" || bindHost === "::" ? obj.ip : bindHost;
    event.sender.send("address", {
      ...obj,
      ip: clientHost,
      port: store.get("port"),
    });
  });
}

/**
 * @description: 获取主窗口当前连接状态
 */
function handleGetConnectionStatus(event) {
  emitConnectionStatus(event.sender);
}

/**
 * @description: 打开设置（改为控制台内路由导航，不再开独立窗口）
 */
function handleOpenSetting() {
  showConsole("/settings");
}

// 允许放行的 store 键白名单（与 main.js 保持一致）
const STORE_GET_ALLOWED_KEYS = new Set([
  "mainTitle",
  "rePrint",
]);

/**
 * @description: sandbox preload 同步读取配置
 */
function handleStoreGet(event, key) {
  event.returnValue = STORE_GET_ALLOWED_KEYS.has(key)
    ? store.get(key)
    : undefined;
}

/**
 * @description: sandbox preload 同步读取 app 版本
 */
function handleAppVersion(event) {
  event.returnValue = app.getVersion();
}

/**
 * @description: 设置窗口所需配置快照（仅投影已知配置键）
 */
function handleSettingsSnapshot(event) {
  const SETTINGS_SNAPSHOT_KEYS = [
    "mainTitle",
    "port",
    "token",
    "nickName",
    "openAtLogin",
    "openAsHidden",
    "connectTransit",
    "transitUrl",
    "transitToken",
    "allowNotify",
    "closeType",
    "pdfPath",
    "defaultPrinter",
    "disabledGpu",
    "rePrint",
    "bindHost",
    "exportDirectory",
  ];
  const snapshot = {};
  SETTINGS_SNAPSHOT_KEYS.forEach((key) => {
    const value = store.get(key);
    if (value !== undefined) snapshot[key] = value;
  });
  event.returnValue = snapshot;
}

/**
 * @description: 复制到剪贴板（sandbox 渲染进程无法直接使用 clipboard 模块，转由主进程执行）
 */
function handleClipboardWrite(event, text) {
  clipboard.writeText(String(text || ""));
}

// ---- 注册入口 ----

/**
 * @description: 一次性注册全部控制台 IPC handler；注册前先移除旧监听，保证幂等。
 */
function registerConsoleIpc() {
  // -- set 业务 --
  ipcMain.removeAllListeners("setConfig");
  ipcMain.on("setConfig", setConfig);

  ipcMain.removeAllListeners("showOpenDialog");
  ipcMain.on("showOpenDialog", showOpenDialog);

  ipcMain.removeAllListeners("openDirectory");
  ipcMain.on("openDirectory", openDirectory);

  ipcMain.removeAllListeners("testTransit");
  ipcMain.on("testTransit", testTransit);

  // closeSetWindow：渲染端已改为 router.back()，主进程侧 no-op（移除旧监听）
  ipcMain.removeAllListeners("closeSetWindow");

  ipcMain.removeAllListeners("getPrintersList");
  ipcMain.on("getPrintersList", getPrintersList);

  // -- printLog 业务 --
  ipcMain.removeAllListeners("request-logs");
  ipcMain.on("request-logs", fetchPrintLogs);

  ipcMain.removeAllListeners("clear-logs");
  ipcMain.on("clear-logs", clearPrintLogs);

  ipcMain.removeAllListeners("reprint");
  ipcMain.on("reprint", rePrint);

  // -- softwareLog 业务 --
  ipcMain.removeHandler("software-log:list-dates");
  ipcMain.handle("software-log:list-dates", () => softwareLogStore.listDates());

  ipcMain.removeHandler("software-log:read");
  ipcMain.handle("software-log:read", (event, date) =>
    softwareLogStore.readLog(date),
  );

  ipcMain.removeHandler("software-log:clear");
  ipcMain.handle("software-log:clear", () => softwareLogStore.clearAll());

  ipcMain.removeAllListeners("software-log:open-folder");
  ipcMain.on("software-log:open-folder", openFolder);

  // -- index 侧（原 main.js）--
  ipcMain.removeAllListeners("notification");
  ipcMain.on("notification", handleNotification);

  ipcMain.removeAllListeners("openSetting");
  ipcMain.on("openSetting", handleOpenSetting);

  ipcMain.removeAllListeners("showMessageBox");
  ipcMain.on("showMessageBox", helper.showMessageBox);

  ipcMain.removeAllListeners("getMachineId");
  ipcMain.on("getMachineId", handleGetMachineId);

  ipcMain.removeAllListeners("getAddress");
  ipcMain.on("getAddress", handleGetAddress);

  ipcMain.removeAllListeners("getConnectionStatus");
  ipcMain.on("getConnectionStatus", handleGetConnectionStatus);

  ipcMain.removeAllListeners("hiprint:store-get");
  ipcMain.on("hiprint:store-get", handleStoreGet);

  ipcMain.removeAllListeners("hiprint:app-version");
  ipcMain.on("hiprint:app-version", handleAppVersion);

  ipcMain.removeAllListeners("hiprint:settings-snapshot");
  ipcMain.on("hiprint:settings-snapshot", handleSettingsSnapshot);

  ipcMain.removeAllListeners("hiprint:clipboard-write");
  ipcMain.on("hiprint:clipboard-write", handleClipboardWrite);
}

module.exports = { registerConsoleIpc };
