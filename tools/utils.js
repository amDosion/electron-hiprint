const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const childProcess = require("child_process");
const { app, Notification, dialog, clipboard, shell } = require("electron");
const address = require("address");
const { getAppWindow } = require("../src/app-window");
const ipp = require("ipp");
const { machineIdSync } = require("node-machine-id");
const Store = require("electron-store");
const { v7: uuidv7 } = require("uuid");
const {
  normalizeHost,
  isBlockedIPv4,
  isBlockedIPv6,
  getIppTargetError: getNetworkIppTargetError,
  getHttpUrlTargetError,
} = require("./network-target-guard");
const {
  normalizeExportDirectoryConfig,
  getExportCapability: getFileExportCapability,
  handleFileExportTask: handleConfiguredFileExportTask,
} = require("./file-export");
const clientStatus = require("./client-status");

/**
 * win32-pdf-printer 的 paper-size-info.exe 会被 electron-builder 解压到 app.asar.unpacked。
 * 运行环境下它仍然使用 app.asar 路径，导致文件不存在。这里提前重写 child_process 的执行路径。
 */
function patchWin32PdfPrinterBinPath() {
  if (process.platform !== "win32" || !app.isPackaged) return;
  const pattern = /app\.asar([\\/])(?=node_modules[\\/]win32-pdf-printer[\\/]paper-size-info\.exe)/i;
  const unpackedSegment = "app.asar.unpacked";
  const unpackedBin = path.join(
    process.resourcesPath,
    unpackedSegment,
    "node_modules",
    "win32-pdf-printer",
    "paper-size-info.exe",
  );
  if (!fs.existsSync(unpackedBin)) return;

  const rewriteCommand = (command) => {
    if (typeof command !== "string" || !pattern.test(command)) return command;
    if (command.includes(unpackedSegment)) return command;
    const replaced = command.replace(pattern, `${unpackedSegment}$1`);
    // 仅包裹 exe 路径，避免把参数一起包进引号导致命令解析失败
    const unpackedBinNormalized = unpackedBin.replace(/\\/g, "/");
    const quoteIfNeeded = (exePath) =>
      exePath.includes(" ") ? `"${exePath}"` : exePath;
    if (
      replaced.startsWith(`"${unpackedBin}"`) ||
      replaced.startsWith(`"${unpackedBinNormalized}"`)
    ) {
      return replaced;
    }
    if (replaced === unpackedBin || replaced === unpackedBinNormalized) {
      return quoteIfNeeded(replaced);
    }
    if (replaced.startsWith(unpackedBin + " ")) {
      return `${quoteIfNeeded(unpackedBin)}${replaced.slice(
        unpackedBin.length,
      )}`;
    }
    if (replaced.startsWith(unpackedBinNormalized + " ")) {
      return `${quoteIfNeeded(unpackedBinNormalized)}${replaced.slice(
        unpackedBinNormalized.length,
      )}`;
    }
    return replaced;
  };

  const wrap = (original) =>
    function patched(command, ...args) {
      return original.call(childProcess, rewriteCommand(command), ...args);
    };

  childProcess.execFile = wrap(childProcess.execFile);
  childProcess.exec = wrap(childProcess.exec);
  childProcess.execSync = wrap(childProcess.execSync);
  const spawn = childProcess.spawn;
  childProcess.spawn = function(command, ...args) {
    return spawn.call(childProcess, rewriteCommand(command), ...args);
  };
  const spawnSync = childProcess.spawnSync;
  childProcess.spawnSync = function(command, ...args) {
    return spawnSync.call(childProcess, rewriteCommand(command), ...args);
  };
}

patchWin32PdfPrinterBinPath();

const { getPaperSizeInfo, getPaperSizeInfoAll } = require("win32-pdf-printer");
const db = require("./database");
let buildInfo = {};
const buildInfoPath = path.join(__dirname, "../build-info.json");
if (fs.existsSync(buildInfoPath)) {
  buildInfo = require(buildInfoPath);
}

Store.initRenderer();

const schema = {
  mainTitle: {
    type: "string",
    default: "Electron-hiprint",
  },
  nickName: {
    type: "string",
    default: "",
  },
  openAtLogin: {
    type: "boolean",
    default: true,
  },
  openAsHidden: {
    type: "boolean",
    default: true,
  },
  connectTransit: {
    type: "boolean",
    default: false,
  },
  transitUrl: {
    type: "string",
    default: "",
  },
  transitToken: {
    type: "string",
    default: "",
  },
  allowNotify: {
    type: "boolean",
    default: true,
  },
  closeType: {
    type: "string",
    enum: ["tray", "quit"],
    default: "tray",
  },
  port: {
    type: "number",
    minimum: 10000,
    default: 17521,
  },
  bindHost: {
    type: "string",
    default: "127.0.0.1",
  },
  allowedOrigins: {
    type: "array",
    default: [],
    items: {
      type: "string",
    },
  },
  allowedIppHosts: {
    type: "array",
    default: [],
    items: {
      type: "string",
    },
  },
  token: {
    type: ["string", "null"],
    default: null,
  },
  pdfPath: {
    type: "string",
    default: app.getPath("temp"),
  },
  defaultPrinter: {
    type: "string",
    default: "",
  },
  exportDirectory: {
    type: "object",
    default: {
      enabled: false,
      path: "",
      displayName: "",
      maxBytes: 52428800,
      allowedExtensions: [
        ".pdf",
        ".doc",
        ".docx",
        ".rtf",
        ".odt",
        ".xls",
        ".xlsx",
        ".xlsm",
        ".csv",
        ".tsv",
        ".ppt",
        ".pptx",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
        ".svg",
        ".tif",
        ".tiff",
        ".txt",
        ".md",
        ".json",
        ".xml",
        ".zip",
      ],
      conflictPolicy: "rename",
    },
  },
  disabledGpu: {
    type: "boolean",
    default: false,
  },
  rePrint: {
    type: "boolean",
    default: true,
  },
};

const store = new Store({ schema });

function generateAuthToken() {
  return crypto.randomBytes(16).toString("hex");
}

function ensureAuthToken() {
  const token = store.get("token");
  if (typeof token === "string" && token.length > 0) return token;
  const generatedToken = generateAuthToken();
  store.set("token", generatedToken);
  return generatedToken;
}

/**
 * @description: 获取当前系统 IP 地址
 * @return {String}
 */
function addressIp() {
  return address.ip();
}

/**
 * @description: 获取当前系统 IPV6 地址
 * @return {String}
 */
function addressIpv6() {
  return address.ipv6();
}

/**
 * @description: 获取当前系统 MAC 地址
 * @return {String}
 */
function addressMac() {
  return new Promise((resolve) => {
    address.mac(function(err, addr) {
      if (err) {
        // 获取失败返回空串而非 Error 对象，避免 clientInfo.mac 被填成序列化错误对象
        resolve("");
      } else {
        resolve(addr);
      }
    });
  });
}

/**
 * @description: 获取当前系统 IP、IPV6、MAC 地址
 * @return {Object}
 */
function addressAll() {
  return new Promise((resolve) => {
    address.mac(function(err, mac) {
      if (err) {
        // 获取失败返回空串而非 Error 对象，避免 mac 被填成序列化错误对象透传到 UI 和客户端
        resolve({ ip: address.ip(), ipv6: address.ipv6(), mac: "" });
      } else {
        resolve({ ip: address.ip(), ipv6: address.ipv6(), mac });
      }
    });
  });
}

/**
 * @description: address 方法重写
 * @return {Object}
 */
const _address = {
  ip: addressIp,
  ipv6: addressIpv6,
  mac: addressMac,
  all: addressAll,
};

/**
 * @description: 检查分片任务实例，用于自动删除超时分片信息
 */
const watchTaskInstance = generateWatchTask(
  () => global.PRINT_FRAGMENTS_MAPPING,
)();

/**
 * @description: 尝试获取客户端唯一id，依赖管理员权限与注册表读取
 * @return {string}
 */
function getMachineId() {
  try {
    return machineIdSync({ original: true });
  } catch (error) {
    // 若获取失败，也可以使用 UUID 代替，需要单独存储 首次创建 后续读取
    // 默认返回空 表示读不到就好；记录错误以便打包后从日志文件排查
    console.error("getMachineId failed", error);
    return "";
  }
}

function getExportDirectoryConfig() {
  return normalizeExportDirectoryConfig(store.get("exportDirectory") || {});
}

function getExportCapability() {
  return getFileExportCapability(getExportDirectoryConfig());
}

function getAllowedIppHosts() {
  const configured = store.get("allowedIppHosts");
  return Array.isArray(configured)
    ? configured.map(normalizeHost).filter(Boolean)
    : [];
}

function getIppTargetError(rawUrl) {
  return getNetworkIppTargetError(rawUrl, getAllowedIppHosts());
}

function handleFileExportTask(client, task) {
  handleConfiguredFileExportTask(client, task, getExportDirectoryConfig());
}

/**
 * @description: 抛出当前客户端信息，提供更多有价值的信息，逐步替换原有 address
 * @param {io.Socket} socket
 * @return {void}
 */
function emitClientInfo(socket) {
  clientStatus.emitClientInfo(socket, {
    address: _address,
    store,
    app,
    getMachineId,
    getExportCapability,
  });
}

async function getConfiguredPrinterList() {
  const defaultPrinter = store.get("defaultPrinter", "");
  const win = getAppWindow();
  if (!win || win.isDestroyed()) return [];
  const printers = await win.webContents.getPrintersAsync();
  return printers.map((printer) => ({
    ...printer,
    defaultPrinter,
    configuredDefault: !!defaultPrinter && printer.name === defaultPrinter,
  }));
}

/**
 * 生成检查分片任务的闭包函数
 * @param {Object} getCheckTarget 获取校验对象，最后会得到global.PRINT_FRAGMENTS_MAPPING
 * @returns {Function}
 */
function generateWatchTask(getCheckTarget) {
  // 记录当前检查任务是否开启，避免重复开启任务
  let isWatching = false;
  /**
   * @description: 检查分片任务实例创建函数
   * @param {Object} config 检查参数，根据实际情况调整
   * @param {number} [config.checkInterval=5] 执行内存检查的时间间隔，单位分钟
   * @param {number} [config.expire=10] 分片信息过期时间，单位分钟，不应过小
   */
  return function generateWatchTaskInstance(config = {}) {
    // 合并用户和默认配置
    const realConfig = Object.assign(
      {
        checkInterval: 5, // 默认检查间隔
        expire: 10, // 默认过期时间
      },
      config,
    );
    return {
      startWatch() {
        if (isWatching) return;
        this.createWatchTimeout();
      },
      createWatchTimeout() {
        // 更新开关状态
        isWatching = true;
        return setTimeout(
          this.clearFragmentsWhichIsExpired.bind(this),
          realConfig.checkInterval * 60 * 1000,
        );
      },
      clearFragmentsWhichIsExpired() {
        const checkTarget = getCheckTarget();
        const currentTimeStamp = Date.now();
        Object.entries(checkTarget).map(([id, fragmentInfo]) => {
          // 获取任务最后更新时间
          const { updateTime } = fragmentInfo;
          // 任务过期时，清除任务信息释放内存
          if (currentTimeStamp - updateTime > realConfig.expire * 60 * 1000) {
            delete checkTarget[id];
          }
        });
        // 获取剩余任务数量
        const printTaskCount = Object.keys(checkTarget).length;
        // 还有打印任务，继续创建检查任务
        if (printTaskCount) this.createWatchTimeout();
        // 更新开关状态
        else isWatching = false;
      },
    };
  };
}

/**
 * SQLite bound-parameter limit
 */
const SQLITE_MAX_VARIABLE_NUMBER = 999;

/**
 * @description: 查询打印状态，按 templateIds 过滤打印记录并通过回调返回结果；
 *               templateIds 为空时返回最近 20 条记录
 * @param {Array<String>|*} templateIds 模板id列表，为空时查询最近 20 条
 * @param {Function} onSuccess 查询成功回调，参数为 rows
 * @param {Function} onError 查询失败回调，参数为 err
 * @return {void}
 */
function queryPrintStatus(templateIds, onSuccess, onError) {
  const baseSelect =
    "SELECT id, timestamp, socketId, clientType, printer, templateId, pageNum, status, rePrintAble, errorMessage FROM print_logs";
  const orderBy = " ORDER BY timestamp DESC, id DESC";

  // Empty templateIds → return latest 20 records
  if (!Array.isArray(templateIds) || templateIds.length === 0) {
    db.all(`${baseSelect}${orderBy} LIMIT 20`, [], (err, rows) => {
      if (err) onError(err);
      else onSuccess(rows);
    });
    return;
  }

  // Enforce SQLite bound-parameter limit
  if (templateIds.length > SQLITE_MAX_VARIABLE_NUMBER) {
    onError(
      new Error(
        `templateIds 长度超过限制，最多支持 ${SQLITE_MAX_VARIABLE_NUMBER} 个 / templateIds exceeds limit, max ${SQLITE_MAX_VARIABLE_NUMBER}`,
      ),
    );
    return;
  }

  const placeholders = templateIds.map(() => "?").join(",");
  db.all(
    `${baseSelect} WHERE templateId IN (${placeholders})${orderBy}`,
    templateIds,
    (err, rows) => {
      if (err) onError(err);
      else onSuccess(rows);
    },
  );
}

function withReplyId(payload, replyId, includeReplyId) {
  return includeReplyId ? Object.assign({}, payload, { replyId }) : payload;
}

function normalizeIppMessage(message) {
  const msg = Object.assign(
    {
      "operation-attributes-tag": {
        "requesting-user-name": "hiPrint",
      },
    },
    message,
  );
  // data 必须是 Buffer 类型
  if (msg.data && !Buffer.isBuffer(msg.data)) {
    if ("string" === typeof msg.data) {
      msg.data = Buffer.from(msg.data, msg.encoding || "utf8");
    } else {
      msg.data = Buffer.from(msg.data);
    }
  }
  return msg;
}

function bindIppHandlers(socket, { label, includeReplyId }) {
  socket.on("ippPrint", (options) => {
    console.log(`${label} ${socket.id}: ippPrint`);
    const replyId = options && options.replyId;
    try {
      const { url, opt, action, message } = options;
      const targetError = getIppTargetError(url);
      if (targetError) {
        socket.emit(
          "ippPrinterCallback",
          withReplyId(
            { type: targetError.name, msg: targetError.message },
            replyId,
            includeReplyId,
          ),
        );
        return;
      }
      let printer = ipp.Printer(url, opt);
      socket.emit(
        "ippPrinterConnected",
        includeReplyId ? { printer, replyId } : printer,
      );
      let msg = normalizeIppMessage(message);
      /**
       * action: Get-Printer-Attributes 获取打印机支持参数
       * action: Print-Job 新建打印任务
       * action: Cancel-Job 取消打印任务
       */
      printer.execute(action, msg, (err, res) => {
        socket.emit(
          "ippPrinterCallback",
          err
            ? withReplyId(
                { type: err.name, msg: err.message },
                replyId,
                includeReplyId,
              )
            : includeReplyId
            ? { replyId }
            : null,
          res,
        );
      });
    } catch (error) {
      console.log(`${label} ${socket.id}: ippPrint error: ${error.message}`);
      socket.emit(
        "ippPrinterCallback",
        withReplyId(
          { type: error.name, msg: error.message },
          replyId,
          includeReplyId,
        ),
      );
    }
  });

  socket.on("ippRequest", (options) => {
    console.log(`${label} ${socket.id}: ippRequest`);
    const replyId = options && options.replyId;
    try {
      const { url, data } = options;
      const targetError = getIppTargetError(url);
      if (targetError) {
        socket.emit(
          "ippRequestCallback",
          withReplyId(
            { type: targetError.name, msg: targetError.message },
            replyId,
            includeReplyId,
          ),
        );
        return;
      }
      let _data = ipp.serialize(data);
      ipp.request(url, _data, (err, res) => {
        socket.emit(
          "ippRequestCallback",
          err
            ? withReplyId(
                { type: err.name, msg: err.message },
                replyId,
                includeReplyId,
              )
            : includeReplyId
            ? { replyId }
            : null,
          res,
        );
      });
    } catch (error) {
      console.log(`${label} ${socket.id}: ippRequest error: ${error.message}`);
      socket.emit(
        "ippRequestCallback",
        withReplyId(
          { type: error.name, msg: error.message },
          replyId,
          includeReplyId,
        ),
      );
    }
  });
}

function enqueuePrintTask(data, socketId, clientType) {
  PRINT_RUNNER.add((done) => {
    data.socketId = socketId;
    data.taskId = uuidv7();
    data.clientType = clientType;
    PRINT_WINDOW.webContents.send("print-new", data);
    getAppWindow()?.webContents.send("printTask", true);
    PRINT_RUNNER_DONE[data.taskId] = done;
  });
}

function bindPrintTaskHandler(socket, clientType) {
  socket.on("news", (data) => {
    if (data) enqueuePrintTask(data, socket.id, clientType);
  });
}

function enqueueRenderTask(data, socketId, clientType, channel) {
  RENDER_RUNNER.add((done) => {
    data.socketId = socketId;
    data.taskId = uuidv7();
    data.clientType = clientType;
    RENDER_WINDOW.webContents.send(channel, data);
    RENDER_RUNNER_DONE[data.taskId] = done;
  });
}

function bindRenderTaskHandlers(socket, clientType) {
  socket.on("render-print", (data) => {
    if (data) enqueueRenderTask(data, socket.id, clientType, "print");
  });

  socket.on("render-jpeg", (data) => {
    if (data) enqueueRenderTask(data, socket.id, clientType, "png");
  });

  socket.on("render-pdf", (data) => {
    if (data) enqueueRenderTask(data, socket.id, clientType, "pdf");
  });
}

function bindFileExportHandler(socket, label) {
  socket.on("file.export", (data) => {
    console.log(`${label} ${socket.id}: file.export`);
    handleFileExportTask(socket, data);
  });
}

function bindPrintStatusHandler(socket, label) {
  socket.on("getPrintStatus", (data) => {
    console.log(`${label} ${socket.id}: getPrintStatus`);
    queryPrintStatus(
      data && Array.isArray(data.templateIds) ? data.templateIds : [],
      (rows) => socket.emit("printStatus", rows),
      (err) => {
        console.error(`${label} ${socket.id}: getPrintStatus error: ${err.message}`);
        socket.emit("printStatusError", { msg: err.message });
      },
    );
  });
}

function bindClientInfoHandlers(socket, label) {
  socket.on("getClientInfo", () => {
    console.log(`${label} ${socket.id}: getClientInfo`);
    emitClientInfo(socket);
  });

  socket.on("refreshPrinterList", async () => {
    console.log(`${label} ${socket.id}: refreshPrinterList`);
    socket.emit("printerList", await getConfiguredPrinterList());
  });
}

/**
 * @description: 作为本地服务端时绑定的 socket 事件
 * @param {*} server
 * @return {void}
 */
function initServeEvent(server) {
  // 必须传入实体
  if (!server) return false;

  /**
   * @description: 校验 token
   */
  server.use((socket, next) => {
    const token = ensureAuthToken();
    const auth = socket.handshake && socket.handshake.auth;
    const providedToken = auth && auth.token;
    if (!providedToken || token !== providedToken) {
      // 不记录对端提交的 token，避免日志成为暴力破解 oracle / 泄露凭据
      console.log(`==> 插件端 Authentication error: ${socket.id}`);
      const err = new Error("Authentication error");
      err.data = {
        content: "Token 错误",
      };
      next(err);
    } else {
      next();
    }
  });

  /**
   * @description: 新的 web client 连入，绑定 socket 事件
   */
  server.on("connect", async (socket) => {
    console.log(`==> 插件端 New Connected: ${socket.id}`);

    // 通知渲染进程已连接
    sendMainWindow("serverConnection", server.engine.clientsCount);
    emitConnectionStatus();

    // 判断是否允许通知
    if (store.get("allowNotify")) {
      // 弹出连接成功通知
      const notification = new Notification({
        title: "新的连接",
        body: `已建立新的连接，当前连接数：${server.engine.clientsCount}`,
      });
      // 显示通知
      notification.show();
    }

    // 向 client 发送打印机列表
    socket.emit("printerList", await getConfiguredPrinterList());

    // 向 client 发送客户端信息
    emitClientInfo(socket);

    bindClientInfoHandlers(socket, "插件端");

    /**
     * @description: client请求 address ，获取本机 IP、IPV6、MAC 地址
     * @description: addressType 为 null 时，返回所有地址
     * @description: 逐步废弃该 api
     * @param {String} addressType ip、ipv6、mac、all === null
     */
    socket.on("address", (addressType) => {
      console.log(
        `插件端 ${socket.id}: get address(${addressType || "未指定类型"})`,
      );
      switch (addressType) {
        case "ip":
        case "ipv6":
          socket.emit("address", addressType, _address[addressType]());
          break;
        case "dns":
        case "interface":
        case "vboxnet":
          // 用处不大的几个信息，直接废弃
          socket.emit("address", addressType, null, "This type is removed.");
          break;
        default:
          addressType = addressType === "mac" ? "mac" : "all";
          _address[addressType]().then((res) => {
            socket.emit("address", addressType, res);
          });
          break;
      }
    });

    /**
     * @description: client 获取打印机纸张信息
     */
    socket.on("getPaperSizeInfo", (printer) => {
      console.log(`插件端 ${socket.id}: getPaperSizeInfo`);
      if (process.platform === "win32") {
        const printerName =
          typeof printer === "string"
            ? printer
            : printer && typeof printer.printer === "string"
            ? printer.printer
            : "";
        let paper = getPaperSizeInfoAll();
        if (printerName) {
          paper =
            paper.find((item) => item.PrinterName === printerName) || null;
        }
        paper && socket.emit("paperSizeInfo", paper);
      }
    });

    bindIppHandlers(socket, { label: "插件端", includeReplyId: false });

    /**
     * @description: client 常规打印任务
     */
    bindPrintTaskHandler(socket, "local");

    /**
     * @description: client 分批打印任务
     */
    socket.on("printByFragments", (data) => {
      if (data) {
        const { total, index, htmlFragment, id } = data;
        const currentInfo =
          PRINT_FRAGMENTS_MAPPING[id] ||
          (PRINT_FRAGMENTS_MAPPING[id] = {
            total,
            fragments: [],
            count: 0,
            updateTime: 0,
          });
        // 仅在「合法 index 且该槽位首次填充」时写入并计数，避免重传/重复/越界
        // 分片把 count 灌大——否则 count 可能在仍有空洞（某 index 未到达）时就达到
        // total，join("") 会把缺失槽位输出成 "undefined"，造成打印内容空洞。
        if (
          Number.isInteger(index) &&
          index >= 0 &&
          index < currentInfo.total &&
          currentInfo.fragments[index] === undefined
        ) {
          currentInfo.fragments[index] = htmlFragment;
          currentInfo.count++;
        }
        // 记录更新时间
        currentInfo.updateTime = Date.now();
        // 全部片段已传输完毕：因 count 只统计「不同的合法 index 槽位」，
        // count === total 即等价于 0..total-1 每个槽位都已填充（无空洞校验）。
        if (currentInfo.total > 0 && currentInfo.count === currentInfo.total) {
          // 清除全局缓存
          delete PRINT_FRAGMENTS_MAPPING[id];
          // 合并全部打印片段信息
          data.html = currentInfo.fragments.join("");
          // 添加打印任务
          enqueuePrintTask(data, socket.id, "local");
        }
        // 开始检查任务
        watchTaskInstance.startWatch();
      }
    });

    bindRenderTaskHandlers(socket, "local");

    // 本地服务端文件导出：镜像中转路径(initClientEvent)的 file.export 监听，
    // 使直连本地 Socket.IO 服务的插件端也能触发文件导出（此前仅中转路径已接线）
    bindFileExportHandler(socket, "插件端");

    /**
     * @description: client 查询打印状态
     * @param {Object} data
     * @param {Array<String>} [data.templateIds] 模板id列表，为空时返回最近 20 条记录
     */
    bindPrintStatusHandler(socket, "插件端");

    /**
     * @description: client 断开连接
     */
    socket.on("disconnect", () => {
      console.log(`==> 插件端 Disconnect: ${socket.id}`);
      sendMainWindow("serverConnection", server.engine.clientsCount);
      emitConnectionStatus();
    });
  });
}

let transitConnectionError = "";

function getPrintBusy() {
  return clientStatus.getPrintBusy(global.PRINT_RUNNER);
}

function getConnectionStatus() {
  return clientStatus.getConnectionStatus({
    socketServer: global.SOCKET_SERVER,
    socketClient: global.SOCKET_CLIENT,
    transitConnectionError,
    printRunner: global.PRINT_RUNNER,
  });
}

function sendMainWindow(channel, payload) {
  return clientStatus.sendMainWindow({ getAppWindow, channel, payload });
}

function emitConnectionStatus(webContents) {
  return clientStatus.emitConnectionStatus({
    getAppWindow,
    webContents,
    status: getConnectionStatus(),
  });
}

/**
 * @description: 作为客户端连接中转服务时绑定的 socket 事件
 * @return {void}
 */
function initClientEvent() {
  // 作为客户端连接中转服务时只有一个全局 client
  var client = global.SOCKET_CLIENT;

  /**
   * @description: 连接中转服务成功，绑定 socket 事件
   */
  client.on("connect", async () => {
    console.log(`==> 中转服务 Connected Transit Server: ${client.id}`);
    transitConnectionError = "";
    // 通知渲染进程已连接
    sendMainWindow("clientConnection", true);
    emitConnectionStatus();

    // 判断是否允许通知
    if (store.get("allowNotify")) {
      // 弹出连接成功通知
      const notification = new Notification({
        title: "已连接中转服务器",
        body: `已连接至中转服务器【${store.get("transitUrl")}】，即刻开印！`,
      });
      // 显示通知
      notification.show();
    }

    // 向 中转服务 发送打印机列表
    client.emit("printerList", await getConfiguredPrinterList());

    // 向 中转服务 发送客户端信息
    emitClientInfo(client);
  });

  bindClientInfoHandlers(client, "中转服务");
  bindIppHandlers(client, { label: "中转服务", includeReplyId: true });

  /**
   * @description: 中转服务 常规打印任务
   */
  bindPrintTaskHandler(client, "transit");
  bindRenderTaskHandlers(client, "transit");
  bindFileExportHandler(client, "中转服务");

  /**
   * @description: 中转服务 查询打印状态
   * @param {Object} data
   * @param {Array<String>} [data.templateIds] 模板id列表，为空时返回最近 20 条记录
   */
  bindPrintStatusHandler(client, "中转服务");

  /**
   * @description: 中转服务 断开连接
   */
  client.on("disconnect", (reason) => {
    console.log(`==> 中转服务 Disconnect: ${client.id}`);
    transitConnectionError = reason || "";
    sendMainWindow("clientConnection", false);
    emitConnectionStatus();
  });

  /**
   * @description: 中转服务连接失败
   */
  client.on("connect_error", (error) => {
    transitConnectionError = (error && error.message) || "连接中转服务器失败";
    console.error(`==> 中转服务 Connect Error: ${transitConnectionError}`);
    sendMainWindow("clientConnection", false);
    emitConnectionStatus();
  });
}

/**
 * @description: 打印机状态码 十进制 -> 十六进制, 返回对应的详细错误信息， 详见：https://github.com/mlmdflr/win32-pdf-printer/blob/51f7a9b3687e260a7d83ea467b22b374fb153b52/paper-size-info/Status.cs
 * @param { String } printerName  打印机名称
 * @return { Object  { StatusMsg: String // 打印机状态详情信息 } }
 */

function getCurrentPrintStatusByName(printerName) {
  if (process.platform === "win32") {
    const { StatusMsg } = getPaperSizeInfoAll().find(
      (item) => item.PrinterName === printerName,
    ) || { StatusMsg: "未找到打印机" };
    return {
      StatusMsg,
    };
  }
  return { StatusMsg: "非Windows系统, 暂不支持" };
}

function showAboutDialog() {
  const detail = `版本: ${app.getVersion()}
提交: ${buildInfo.commitId}
日期: ${buildInfo.commitDate}
Electron: ${process.versions.electron}
Chromium: ${process.versions.chrome}
Node.js: ${process.versions.node}
V8: ${process.versions.v8}
OS: ${os.type()} ${os.arch()} ${os.release()}`.trim();
  const title = store.get("mainTitle") || "Electron-hiprint";
  dialog
    .showMessageBox({
      title: `关于 ${title}`,
      message: title,
      type: "info",
      buttons: ["反馈", "复制", "确定"],
      noLink: true,
      defaultId: 0,
      detail,
      cancelId: 2,
      normalizeAccessKeys: true,
    })
    .then((result) => {
      if (result.response === 0) {
        const issuesUrl = new URL(
          `https://github.com/amDosion/electron-hiprint/issues/new`,
        );
        issuesUrl.searchParams.set(
          "title",
          `[反馈][${app.getVersion()}] 在此处完善反馈标题`,
        );
        const issuesBody = `## 问题描述
请在此处详细描述你遇到的问题

## 版本信息
  
${detail}`;
        issuesUrl.searchParams.set("body", issuesBody);
        shell.openExternal(issuesUrl.href);
      }
      if (result.response === 1) {
        clipboard.writeText(detail);
      }
    });
}

module.exports = {
  store,
  address: _address,
  initServeEvent,
  initClientEvent,
  getExportCapability,
  getConnectionStatus,
  emitConnectionStatus,
  getCurrentPrintStatusByName,
  getMachineId,
  showAboutDialog,
  getHttpUrlTargetError,
  isBlockedIPv4,
  isBlockedIPv6,
};
