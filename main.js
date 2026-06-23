/*
 * @Date: 2024-01-25 15:52:14
 * @LastEditors: admin@54xavier.cn
 * @LastEditTime: 2024-12-23 15:23:56
 * @FilePath: \electron-hiprint\main.js
 */
const { app, BrowserWindow, Tray, Menu, protocol } = require("electron");
const electronLog = require("electron-log");
const fs = require("fs");
const path = require("path");
const server = require("http").createServer();

function applyUserDataPathOverride() {
  const userDataDir = process.env.HIPRINT_USER_DATA_DIR;
  if (!userDataDir) return;

  const resolvedUserDataDir = path.resolve(userDataDir);
  fs.mkdirSync(resolvedUserDataDir, { recursive: true });
  app.setPath("userData", resolvedUserDataDir);
}

applyUserDataPathOverride();

const helper = require("./src/helper");
const printSetup = require("./src/print");
const renderSetup = require("./src/render");
const { getAssetUrl } = require("./src/asset-url");
const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require("./src/asset-protocol");
const { runOnlineUpgrade } = require("./src/online-upgrade-runner");
const {
  store,
  initServeEvent,
  initClientEvent,
  showAboutDialog,
} = require("./tools/utils");
const {
  getAppWindow,
  showConsole,
  prewarmConsole,
  destroyConsole,
} = require("./src/app-window");
const { registerConsoleIpc } = require("./src/console-ipc");

const TaskRunner = require("concurrent-tasks");

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

// 软件日志只写 sqlite，禁用 electron-log 默认文件 transport，避免继续生成按天 .log 文件。
const softwareLogStore = require("./src/software-log-store");
electronLog.transports.file.level = false;
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

// 托盘
global.APP_TRAY = null;
// 打印窗口
global.PRINT_WINDOW = null;
// 渲染窗口
global.RENDER_WINDOW = null;
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

  // 连接模式互斥：配置了中转就只走中转客户端，未配置就只走本地服务端。
  // 二者不共存——本地服务端与中转客户端各自持有完整的 socket 事件（含 file.export），
  // 激活哪一侧由“是否配置中转”唯一决定，无旧版“本地常驻 + 中转叠加”的双分支。
  const transitConfigured =
    store.get("connectTransit") &&
    store.get("transitUrl") &&
    store.get("transitToken");

  if (transitConfigured) {
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
    return;
  }

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

  // 当运行第二个实例时（如已在托盘运行时再次双击桌面图标），显示并聚焦控制台
  app.on("second-instance", () => {
    showConsole("/status");
  });

  // 当electron完成初始化
  app.whenReady().then(async () => {
    // 注册 app:// 自定义协议处理器：UI 窗口经此协议从应用内 assets/ 加载，
    // 拥有真实安全 origin，且 handler 严格限定目录、做路径穿越防护，
    // 不再使用 file:// 暴露任意本地文件系统访问。必须在加载任何窗口前注册。
    registerAssetProtocol();
    // 初始化系统设置
    systemSetup();
    // 注册控制台全部 IPC handler（幂等，进程内单实例常驻）
    registerConsoleIpc();
    // 预热控制台窗口（后台隐藏建窗，避免首次点击托盘冷启动）
    await prewarmConsole();
    // 非 openAsHidden 启动时显示控制台
    const openedAtLogin =
      process.argv.includes("--openAsHidden") ||
      (process.platform === "darwin" &&
        app.getLoginItemSettings().wasOpenedAtLogin);
    if (!(store.get("openAsHidden") && openedAtLogin)) {
      showConsole("/status");
    }
    // 初始化托盘
    initTray();
    // 打印窗口初始化
    await printSetup();
    // 渲染窗口初始化
    await renderSetup();
    // 本地服务初始化
    startLocalServices();
    // 启动后静默检查客户端在线升级
    if (app.isPackaged) {
      setTimeout(() => {
        runOnlineUpgrade({
          parentWindow: getAppWindow(),
          onStatus: updateOnlineUpgradeTrayState,
          silent: true,
        }).catch((error) => console.error("启动自动检查更新失败:", error));
      }, 5000);
    }
    app.on("activate", function() {
      if (BrowserWindow.getAllWindows().length === 0) {
        showConsole("/status");
      }
    });
    console.log("==> Electron-hiprint 启动 <==");
  });

  // socket server 生命周期解耦：绑到 app 退出而非控制台窗口销毁
  app.on("before-quit", () => {
    try {
      server.close();
    } catch {
      /* 关闭异常忽略 */
    }
  });
}

/**
 * @description: 初始化系统设置（登录项、菜单栏）
 * @return {Void}
 */
function systemSetup() {
  // 隐藏菜单栏
  Menu.setApplicationMenu(null);
  // 登录项设置（仅打包环境）
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: store.get("openAtLogin"),
      openAsHidden: store.get("openAsHidden"),
      // Windows 不支持原生 openAsHidden：用启动参数标记"随登录自启动"，
      // 以便仅在登录自启时隐藏，手动双击桌面图标启动时正常显示窗口。
      args: store.get("openAsHidden") ? ["--openAsHidden"] : [],
    });
  }
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

  // 监听点击事件（linux 上无法识别 tray click/double-click，菜单项"显示主窗口"兜底）
  APP_TRAY.on("click", function() {
    console.log("==>TRAY 点击托盘图标<==");
    showConsole("/status");
  });
  return APP_TRAY;
}

function buildTrayMenuTemplate() {
  return [
    {
      // 神知道为什么 linux 上无法识别 tray click、double-click，只能添加一个菜单
      label: "显示主窗口",
      click: () => {
        showConsole("/status");
      },
    },
    {
      label: "设置",
      click: () => {
        console.log("==>TRAY 打开设置窗口<==");
        showConsole("/settings");
      },
    },
    {
      label: "软件日志",
      click: () => {
        console.log("==>TRAY 查看软件日志<==");
        showConsole("/software-log");
      },
    },
    {
      label: "打印记录",
      click: () => {
        console.log("==>TRAY 打开打印记录窗口<==");
        showConsole("/print-log");
      },
    },
    {
      label: onlineUpgradeTrayState.busy ? "升级处理中..." : "在线升级",
      enabled: !onlineUpgradeTrayState.busy,
      click: () => {
        console.log("==>TRAY 在线升级<==");
        runOnlineUpgrade({
          parentWindow: getAppWindow(),
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
      label: "重启软件",
      enabled: !onlineUpgradeTrayState.busy,
      click: () => {
        console.log("==>TRAY 重启软件<==");
        restartApp();
      },
    },
    {
      label: "退出",
      click: () => {
        console.log("==>TRAY 退出应用<==");
        destroyConsole();
        helper.appQuit();
      },
    },
  ];
}

function restartApp() {
  destroyConsole();
  app.relaunch();
  app.exit();
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

// 把 app:// 注册为标准 + 安全来源。registerSchemesAsPrivileged 必须在 app ready 之前、
// 模块顶层同步调用，因此放在 initialize() 之前。
registerAssetSchemeAsPrivileged();

// 初始化主窗口
initialize();
