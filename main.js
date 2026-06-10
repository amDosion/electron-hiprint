/*
 * @Date: 2024-01-25 15:52:14
 * @LastEditors: admin@54xavier.cn
 * @LastEditTime: 2024-12-23 15:23:56
 * @FilePath: \electron-hiprint\main.js
 */
const {
  app,
  BrowserWindow,
  WebContentsView,
  ipcMain,
  Notification,
  Tray,
  Menu,
  clipboard,
  protocol,
} = require("electron");
const electronLog = require("electron-log");
const path = require("path");
const server = require("http").createServer();
const helper = require("./src/helper");
const printSetup = require("./src/print");
const renderSetup = require("./src/render");
const setSetup = require("./src/set");
const printLogSetup = require("./src/printLog");
const softwareLogSetup = require("./src/softwareLog");
const { getAssetUrl } = require("./src/asset-url");
const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require("./src/asset-protocol");
const { resolveBuiltinPluginVersion } = require("./src/plugin-sync");
const { runOnlineUpgrade } = require("./src/online-upgrade-runner");
const {
  store,
  address,
  initServeEvent,
  initClientEvent,
  emitConnectionStatus,
  getMachineId,
  showAboutDialog,
} = require("./tools/utils");

const TaskRunner = require("concurrent-tasks");
const dayjs = require("dayjs");

const logPath = store.get("logPath") || app.getPath("logs");
const SOCKET_MAX_HTTP_BUFFER_SIZE = 52428800;

function isLoopbackOrigin(requestOrigin) {
  if (!requestOrigin) return true;
  try {
    const { hostname } = new URL(requestOrigin);
    return ["localhost", "127.0.0.1", "::1"].includes(hostname);
  } catch {
    return false;
  }
}

function getAllowedSocketOrigins() {
  const configured = store.get("allowedOrigins");
  return Array.isArray(configured)
    ? configured.filter((origin) => typeof origin === "string" && origin)
    : [];
}

function isAllowedSocketOrigin(requestOrigin) {
  if (isLoopbackOrigin(requestOrigin)) return true;
  return getAllowedSocketOrigins().includes(requestOrigin);
}

Object.assign(console, electronLog.functions);

electronLog.transports.file.resolvePathFn = () =>
  path.join(logPath, dayjs().format("YYYY-MM-DD.log"));

// 软件日志双写到 sqlite：软件日志窗口数据源以 sqlite 为准（与打印日志统一），
// 文本 transport 保留作崩溃态同步落盘兜底。transport 内部容错且禁用 console。
const softwareLogStore = require("./src/software-log-store");
electronLog.transports.sqlite = softwareLogStore.appendFromTransport;

// 监听崩溃事件
process.on("uncaughtException", (error) => {
  console.error(error);
});

// 监听渲染进程崩溃
app.on("web-contents-created", (event, contents) => {
  contents.on("render-process-gone", (event, details) => {
    console.error(details.reason);
  });
});

if (store.get("disabledGpu")) {
  app.commandLine.appendSwitch("disable-gpu");
}

// 主进程
global.MAIN_WINDOW = null;
// 托盘
global.APP_TRAY = null;
// 打印窗口
global.PRINT_WINDOW = null;
// 设置窗口
global.SET_WINDOW = null;
// 渲染窗口
global.RENDER_WINDOW = null;
// 打印日志窗口
global.PRINT_LOG_WINDOW = null;
// 软件日志窗口
global.SOFTWARE_LOG_WINDOW = null;
// socket.io 服务端
global.SOCKET_SERVER = null;
// socket.io-client 客户端
global.SOCKET_CLIENT = null;
// 打印队列，解决打印并发崩溃问题
global.PRINT_RUNNER = new TaskRunner({ concurrency: 1 });
// 打印队列 done 集合
global.PRINT_RUNNER_DONE = {};
// 分批打印任务的打印任务信息
global.PRINT_FRAGMENTS_MAPPING = {
  // [id: string]: { // 当前打印任务id，当此任务完成或超过指定时间会删除该对象
  //   {
  //      total: number, // html片段总数
  //      count: number, // 已经保存完成的片段数量，当count与total相同时，所有片段传输完成
  //      fragments: Array<string | undefined>, // 按照顺序摆放的html文本片段
  //      updateTime: number, // 最后更新此任务信息的时间戳，用于超时时移除此对象
  //   }
  // }
};
global.RENDER_RUNNER = new TaskRunner({ concurrency: 1 });
global.RENDER_RUNNER_DONE = {};

// socket.io 服务端，用于创建本地服务
const ioServer = (global.SOCKET_SERVER = new require("socket.io")(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: SOCKET_MAX_HTTP_BUFFER_SIZE,
  allowEIO3: true, // 兼容 Socket.IO 2.x
  // 跨域问题(Socket.IO 3.x 使用这种方式)
  cors: {
    // 兼容 Socket.IO 2.x
    origin: (requestOrigin, callback) => {
      if (isAllowedSocketOrigin(requestOrigin)) {
        callback(null, requestOrigin || true);
        return;
      }
      callback(new Error("CORS origin denied"));
    },
    methods: "GET, POST, PUT, DELETE, OPTIONS",
    allowedHeaders: "*",
    // 详情参数见 https://www.npmjs.com/package/cors
    credentials: false,
  },
}));

// socket.io 客户端，用于连接中转服务
const ioClient = require("socket.io-client").io;
let localServicesStarted = false;
let localSocketEventsInitialized = false;
let onlineUpgradeTrayState = {
  busy: false,
  message: "",
  state: "idle",
};

server.on("error", (error) => {
  localServicesStarted = false;
  console.error(`==> 本地服务启动失败: ${error.message}`);
});

function startLocalServices() {
  if (localServicesStarted) return;
  localServicesStarted = true;

  if (!localSocketEventsInitialized) {
    initServeEvent(ioServer);
    localSocketEventsInitialized = true;
  }

  server.listen(
    store.get("port") || 17521,
    store.get("bindHost") || "127.0.0.1",
    () => {
      console.log(
        `==> 本地服务监听 ${store.get("bindHost") || "127.0.0.1"}:${store.get(
          "port",
        ) || 17521} <==`,
      );
    },
  );

  if (
    store.get("connectTransit") &&
    store.get("transitUrl") &&
    store.get("transitToken")
  ) {
    global.SOCKET_CLIENT = ioClient(store.get("transitUrl"), {
      transports: ["websocket"],
      query: {
        client: "electron-hiprint",
      },
      auth: {
        token: store.get("transitToken"),
      },
    });

    initClientEvent();
  }
}

/**
 * @description: 初始化
 */
async function initialize() {
  // 限制一个窗口
  const gotTheLock = app.requestSingleInstanceLock();
  if (!gotTheLock) {
    // 销毁所有窗口、托盘、退出应用
    helper.appQuit();
    return;
  }

  // 当运行第二个实例时（如已在托盘运行时再次双击桌面图标），显示并聚焦主窗口
  app.on("second-instance", () => {
    if (MAIN_WINDOW) {
      showMainWindow();
    }
  });

  // 允许渲染进程创建通知
  ipcMain.on("notification", (event, data) => {
    const notification = new Notification(data);
    // 显示通知
    notification.show();
  });

  // 打开设置窗口
  ipcMain.on("openSetting", openSetWindow);

  // 统一弹出消息框监听（合并原 set.js / render.js 各自注册的同名监听，避免一次消息弹两个框）
  ipcMain.on("showMessageBox", helper.showMessageBox);

  // 获取设备唯一id
  ipcMain.on("getMachineId", (event) => {
    const machineId = getMachineId();
    event.sender.send("machineId", machineId);
  });

  // 获取设备ip、mac等信息
  ipcMain.on("getAddress", (event) => {
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
  });

  // 获取主窗口当前连接状态，避免只依赖 socket 增量事件导致初始显示过期。
  ipcMain.on("getConnectionStatus", (event) => {
    emitConnectionStatus(event.sender);
  });

  // 供 sandbox 化的 preload 同步读取配置/版本
  // （sandbox 渲染进程的 preload 不能 require electron-store 或 json 文件，改走同步 IPC 保持原同步契约）
  // 仅放行 preload 实际需要的非敏感键，杜绝渲染进程读取 token/transitToken 等凭据。
  const STORE_GET_ALLOWED_KEYS = new Set([
    "mainTitle", // index preload 窗口标题
    "pluginVersion", // render preload 插件版本
    "rePrint", // printLog preload 重打开关
  ]);
  ipcMain.on("hiprint:store-get", (event, key) => {
    event.returnValue = STORE_GET_ALLOWED_KEYS.has(key)
      ? store.get(key)
      : undefined;
  });
  ipcMain.on("hiprint:app-version", (event) => {
    event.returnValue = app.getVersion();
  });
  // 设置窗口所需配置快照：仅投影已知配置键，避免把整个 store（含未来新增的非设置字段）自动暴露给渲染进程
  ipcMain.on("hiprint:settings-snapshot", (event) => {
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
      "logPath",
      "pdfPath",
      "defaultPrinter",
      "disabledGpu",
      "pluginVersion",
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
  });
  // 复制到剪贴板（sandbox 渲染进程的 preload 不能直接使用 clipboard 模块，转由主进程执行）
  ipcMain.on("hiprint:clipboard-write", (event, text) => {
    clipboard.writeText(String(text || ""));
  });

  // 当electron完成初始化
  app.whenReady().then(() => {
    // 注册 app:// 自定义协议处理器：UI 窗口经此协议从应用内 assets/ 加载，
    // 拥有真实安全 origin，且 handler 严格限定目录、做路径穿越防护，
    // 不再使用 file:// 暴露任意本地文件系统访问。必须在加载任何窗口前注册。
    registerAssetProtocol();
    // 创建浏览器窗口
    createWindow();
    app.on("activate", function() {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    console.log("==> Electron-hiprint 启动 <==");
  });
}

/**
 * @description: 创建渲染进程 主窗口
 * @return {BrowserWindow} MAIN_WINDOW 主窗口
 */
async function createWindow() {
  const windowOptions = {
    width: 500, // 窗口宽度
    height: 300, // 窗口高度
    title: store.get("mainTitle") || "Electron-hiprint",
    useContentSize: true, // 窗口大小不包含边框
    center: true, // 居中
    resizable: false, // 禁止窗口缩放
    show: false, // 初始隐藏
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "src/preload/index.js"),
    },
  };

  // 窗口左上角图标
  if (!app.isPackaged) {
    windowOptions.icon = path.join(__dirname, "build/icons/256x256.png");
  } else {
    app.setLoginItemSettings({
      openAtLogin: store.get("openAtLogin"),
      openAsHidden: store.get("openAsHidden"),
      // Windows 不支持原生 openAsHidden：用启动参数标记"随登录自启动"，
      // 以便仅在登录自启时隐藏，手动双击桌面图标启动时正常显示窗口。
      args: store.get("openAsHidden") ? ["--openAsHidden"] : [],
    });
  }

  // 创建主窗口
  MAIN_WINDOW = new BrowserWindow(windowOptions);

  // 添加加载页面 解决白屏的问题
  loadingView(windowOptions);

  // 初始化系统设置
  systemSetup();

  await ensureBuiltinPlugin();

  // 加载主页面
  MAIN_WINDOW.webContents.loadURL(getAssetUrl("index.html"));

  // 退出
  MAIN_WINDOW.on("closed", () => {
    MAIN_WINDOW = null;
    server.close();
  });

  // 点击关闭，最小化到托盘
  MAIN_WINDOW.on("close", (event) => {
    if (store.get("closeType") === "tray") {
      // 最小化到托盘
      MAIN_WINDOW.hide();

      // 隐藏任务栏
      MAIN_WINDOW.setSkipTaskbar(true);

      // 阻止窗口关闭
      event.preventDefault();
    } else {
      // 销毁所有窗口、托盘、退出应用
      helper.appQuit();
    }
  });

  // 主窗口 Dom 加载完毕
  MAIN_WINDOW.webContents.on("dom-ready", async () => {
    try {
      // openAsHidden 仅应在"随系统登录自启动"时隐藏窗口；手动启动（双击桌面图标）应正常显示。
      // Windows 通过登录项启动参数 --openAsHidden 标记自启，macOS 用 wasOpenedAtLogin 判定。
      const openedAtLogin =
        process.argv.includes("--openAsHidden") ||
        (process.platform === "darwin" &&
          app.getLoginItemSettings().wasOpenedAtLogin);
      if (!(store.get("openAsHidden") && openedAtLogin)) {
        MAIN_WINDOW.show();
      }
      // 未打包时打开开发者工具
      if (!app.isPackaged) {
        MAIN_WINDOW.webContents.openDevTools();
      }
    } catch (error) {
      console.error(error);
    }
  });

  // 初始化托盘
  initTray();
  // 打印窗口初始化
  await printSetup();
  // 渲染窗口初始化
  await renderSetup();
  // 本地服务初始化不依赖主窗口 DOM，避免页面加载失败导致服务不可用。
  startLocalServices();

  // 启动后静默检查客户端在线升级：仅打包环境执行，发现新版本才弹窗提示，
  // 无新版本或检查失败时静默处理，不打扰用户。
  if (app.isPackaged) {
    setTimeout(() => {
      runOnlineUpgrade({
        parentWindow: MAIN_WINDOW,
        onStatus: updateOnlineUpgradeTrayState,
        silent: true,
      }).catch((error) => console.error("启动自动检查更新失败:", error));
    }, 5000);
  }

  return MAIN_WINDOW;
}

function ensureBuiltinPlugin() {
  try {
    const result = resolveBuiltinPluginVersion();
    console.log(`==> 内置渲染插件已启用: ${result.pluginVersion} <==`);
  } catch (error) {
    console.error(`==> 内置渲染插件解析失败: ${error.message} <==`);
  }
}

/**
 * @description: 加载等待页面，解决主窗口白屏问题
 * @param {Object} windowOptions 主窗口配置
 * @return {Void}
 */
function loadingView(windowOptions) {
  const loadingContentView = new WebContentsView();
  MAIN_WINDOW.contentView.addChildView(loadingContentView);
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
    MAIN_WINDOW.contentView.removeChildView(loadingContentView);
  };

  // dom 加载完毕移除加载视图；加载失败也清理，避免 WebContents 泄漏
  MAIN_WINDOW.webContents.on("dom-ready", removeLoadingView);
  MAIN_WINDOW.webContents.on("did-fail-load", removeLoadingView);
}

/**
 * @description: 初始化系统设置
 * @return {Void}
 */
function systemSetup() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);
}

/**
 * @description: 显示主窗口
 * @return {Void}
 */
function showMainWindow() {
  if (MAIN_WINDOW.isMinimized()) {
    // 将窗口从最小化状态恢复到以前的状态
    MAIN_WINDOW.restore();
  }
  if (!MAIN_WINDOW.isVisible()) {
    // 主窗口关闭不会被销毁，只是隐藏，重新显示即可
    MAIN_WINDOW.show();
  }
  if (!MAIN_WINDOW.isFocused()) {
    // 主窗口未聚焦，使其聚焦
    MAIN_WINDOW.focus();
  }
  MAIN_WINDOW.setSkipTaskbar(false);
}

/**
 * @description: 初始化托盘
 * @return {Tray} APP_TRAY 托盘实例
 */
function initTray() {
  let trayPath = path.join(app.getAppPath(), "assets/icons/tray.png");

  APP_TRAY = new Tray(trayPath);

  // 托盘提示标题
  APP_TRAY.setToolTip("hiprint");

  refreshTrayMenu();

  // 监听点击事件
  APP_TRAY.on("click", function() {
    console.log("==>TRAY 点击托盘图标<==");
    showMainWindow();
  });
  return APP_TRAY;
}

function buildTrayMenuTemplate() {
  return [
    {
      // 神知道为什么 linux 上无法识别 tray click、double-click，只能添加一个菜单
      label: "显示主窗口",
      click: () => {
        showMainWindow();
      },
    },
    {
      label: "设置",
      click: () => {
        console.log("==>TRAY 打开设置窗口<==");
        openSetWindow();
      },
    },
    {
      label: "软件日志",
      click: () => {
        console.log("==>TRAY 查看软件日志<==");
        if (!SOFTWARE_LOG_WINDOW) {
          softwareLogSetup();
        } else {
          SOFTWARE_LOG_WINDOW.show();
        }
      },
    },
    {
      label: "打印记录",
      click: () => {
        console.log("==>TRAY 打开打印记录窗口<==");
        if (!PRINT_LOG_WINDOW) {
          printLogSetup();
        } else {
          PRINT_LOG_WINDOW.show();
        }
      },
    },
    {
      label: onlineUpgradeTrayState.busy ? "升级处理中..." : "在线升级",
      enabled: !onlineUpgradeTrayState.busy,
      click: () => {
        console.log("==>TRAY 在线升级<==");
        runOnlineUpgrade({
          parentWindow: MAIN_WINDOW,
          onStatus: updateOnlineUpgradeTrayState,
        });
      },
    },
    {
      label: "关于",
      click: () => {
        console.log("==>TRAY 打开关于弹框<==");
        showAboutDialog();
      },
    },
    {
      label: "退出",
      click: () => {
        console.log("==>TRAY 退出应用<==");
        helper.appQuit();
      },
    },
  ];
}

function updateOnlineUpgradeTrayState(status) {
  onlineUpgradeTrayState = {
    busy: status && status.busy === true,
    message: (status && status.message) || "",
    state: (status && status.state) || "idle",
  };
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (APP_TRAY) {
    APP_TRAY.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate()));
  }
}

/**
 * @description: 打开设置窗口
 * @return {BrowserWindow} SET_WINDOW 设置窗口
 */
async function openSetWindow() {
  if (!SET_WINDOW) {
    await setSetup();
  } else {
    SET_WINDOW.show();
  }
  return SET_WINDOW;
}

// 把 app:// 注册为标准 + 安全来源。registerSchemesAsPrivileged 必须在 app ready 之前、
// 模块顶层同步调用，因此放在 initialize() 之前。
registerAssetSchemeAsPrivileged();

// 初始化主窗口
initialize();
