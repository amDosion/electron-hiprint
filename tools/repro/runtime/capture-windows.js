"use strict";

// 截取 console SPA 各 route 的真实渲染图（需真实 Electron），用于 UI 审查。
// 经 app:// 加载 console.html route + 真实 preload，capturePage 存 PNG 到 docs/ui-redesign/rendered-*.png。
// 可选：HIPRINT_CAPTURE_TARGETS=printLog,softwareLog 只截指定 route；
//      HIPRINT_CAPTURE_OUT_DIR=.omx/artifacts/ui-capture 输出到临时目录。
// 运行：npx electron tools/repro/runtime/capture-windows.js

const path = require("path");
const fs = require("fs");
const os = require("os");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

const USER_DATA_DIR = path.join(
  os.tmpdir(),
  `electron-hiprint-capture-${process.pid}`,
);
fs.mkdirSync(USER_DATA_DIR, { recursive: true });
app.setPath("userData", USER_DATA_DIR);
app.once("will-quit", () => {
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
});

// 应答 console preload 的同步取值（mainTitle / rePrint / app-version）
ipcMain.on("hiprint:store-get", (event, key) => {
  if (key === "mainTitle") event.returnValue = "Electron-hiprint";
  else if (key === "rePrint") event.returnValue = 1;
  else event.returnValue = undefined;
});
ipcMain.on("hiprint:app-version", (event) => {
  event.returnValue = "1.0.29";
});
ipcMain.on("hiprint:settings-snapshot", (event) => {
  event.returnValue = {
    port: 17521,
    token: "",
    nickName: "",
    closeType: "tray",
    pdfPath: "C:/ProgramData/hiprint/pdf",
    defaultPrinter: "",
    exportDirectory: { enabled: false },
  };
});
ipcMain.on("request-logs", (event) => {
  event.sender.send("print-logs", {
    rows: buildPrintLogRows(18),
    total: 18,
  });
});
ipcMain.on("clear-logs", () => {});
ipcMain.on("reprint", () => {});
ipcMain.handle("software-log:list-dates", () => ["2026-06-14", "2026-06-13"]);
ipcMain.handle("software-log:read", (_event, date) => ({
  file: String(date),
  truncated: false,
  lines: [
    { ts: "2026-06-14 09:00:00", level: "info", msg: "应用启动，sqlite 日志记录已启用" },
    { ts: "2026-06-14 09:00:01", level: "warn", msg: "打印服务端口重试中" },
    {
      ts: "2026-06-14 09:00:02",
      level: "error",
      msg:
        "打印任务失败 Error: " +
        "LONG_STACK_TOKEN_WITHOUT_SPACES_".repeat(10) +
        " at src/pdf-print.js:88:13",
    },
    { ts: "2026-06-14 09:00:03", level: "debug", msg: "窗口刷新完成" },
  ],
}));
ipcMain.on("software-log:open-folder", () => {});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));

registerAssetSchemeAsPrivileged();
app.disableHardwareAcceleration();

function buildPrintLogRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    timestamp: `2026-06-14 09:${String(index).padStart(2, "0")}:00`,
    clientType: index % 2 ? "transit" : "local",
    printer: index % 3 ? "ZDesigner ZT211-203dpi ZPL" : "Microsoft Print to PDF",
    templateId: `shipping-label-${index + 1}`,
    pageNum: (index % 4) + 1,
    status: index % 5 ? "success" : "failed",
    errorMessage: index % 5
      ? ""
      : "打印机返回超长错误：" + "PAPER_OUT_STATUS_TOKEN_".repeat(8),
    rePrintAble: 1,
  }));
}

const OUT_DIR = process.env.HIPRINT_CAPTURE_OUT_DIR
  ? path.resolve(REPO_ROOT, process.env.HIPRINT_CAPTURE_OUT_DIR)
  : path.join(REPO_ROOT, "docs/ui-redesign");
const TARGET_FILTER = new Set(
  String(process.env.HIPRINT_CAPTURE_TARGETS || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean),
);
const ALL_TARGETS = [
  {
    name: "status",
    route: "#/status",
    preload: "src/preload/console.js",
    width: 1080,
    height: 640,
  },
  {
    name: "settings",
    route: "#/settings/basic",
    preload: "src/preload/console.js",
    width: 1080,
    height: 640,
  },
  {
    name: "printLog",
    route: "#/print-log",
    preload: "src/preload/console.js",
    width: 1040,
    height: 660,
  },
  {
    name: "softwareLog",
    route: "#/software-log",
    preload: "src/preload/console.js",
    width: 1040,
    height: 620,
  },
];
const TARGETS =
  TARGET_FILTER.size > 0 ? ALL_TARGETS.filter((target) => TARGET_FILTER.has(target.name)) : ALL_TARGETS;

async function captureOne(target) {
  const failedLoads = [];
  const win = new BrowserWindow({
    width: target.width,
    height: target.height,
    show: true,
    x: 60,
    y: 60,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(REPO_ROOT, target.preload),
    },
  });
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    failedLoads.push({ code, desc, url });
  });
  await win.loadURL(`app://bundle/console.html${target.route}`);
  // 等待挂载 + 首帧绘制
  await new Promise((r) => setTimeout(r, 900));
  const probe = await win.webContents.executeJavaScript(`(() => ({
    origin: location.origin,
    hash: location.hash,
    appChildren: document.querySelector('#app')?.children.length ?? -1
  }))()`);
  const image = await win.capturePage();
  const outPath = path.join(OUT_DIR, `rendered-${target.name}.png`);
  fs.writeFileSync(outPath, image.toPNG());
  win.close();
  return { outPath, route: target.route, probe, failedLoads };
}

let finished = false;
function finish(saved, code) {
  if (finished) return;
  finished = true;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.destroy();
  }
  console.log("CAPTURE_DONE " + JSON.stringify(saved));
  app.exit(code);
  const forceExit = setTimeout(() => process.exit(code), 1000);
  forceExit.unref && forceExit.unref();
}

const killTimer = setTimeout(() => {
  finish([{ error: "timeout" }], 1);
}, 90000);
killTimer.unref && killTimer.unref();

app.whenReady().then(async () => {
  registerAssetProtocol();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const saved = [];
  let failed = false;
  for (const target of TARGETS) {
    try {
      const step = await captureOne(target);
      if (
        step.probe.origin !== "app://bundle" ||
        step.probe.hash !== target.route ||
        step.probe.appChildren < 1 ||
        step.failedLoads.length > 0
      ) {
        failed = true;
      }
      saved.push({ name: target.name, ...step });
    } catch (err) {
      failed = true;
      saved.push({ name: target.name, error: String(err) });
    }
  }
  clearTimeout(killTimer);
  finish(saved, failed ? 1 : 0);
});

app.on("window-all-closed", () => {});
