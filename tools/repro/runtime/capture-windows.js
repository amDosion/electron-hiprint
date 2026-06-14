"use strict";

// 截取已迁移窗口的真实渲染图（需真实 Electron），用于 UI 审查。
// 经 app:// 加载各窗口 + 真实 preload，capturePage 存 PNG 到 docs/ui-redesign/rendered-*.png。
// 运行：npx electron tools/repro/runtime/capture-windows.js

const path = require("path");
const fs = require("fs");
const REPO_ROOT = path.resolve(__dirname, "../../..");

const electron = require("electron");
const { app, BrowserWindow, ipcMain } = electron;

app.getAppPath = () => REPO_ROOT;

// 应答各 preload 的同步取值（mainTitle / rePrint / app-version）
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
ipcMain.on("setContentSize", () => {});

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));

registerAssetSchemeAsPrivileged();
app.disableHardwareAcceleration();

const OUT_DIR = path.join(REPO_ROOT, "docs/ui-redesign");
const TARGETS = [
  { name: "index", preload: "src/preload/index.js", width: 500, height: 300 },
  { name: "set", preload: "src/preload/set.js", width: 520, height: 720 },
  {
    name: "printLog",
    preload: "src/preload/printLog.js",
    width: 1040,
    height: 660,
  },
  {
    name: "softwareLog",
    preload: "src/preload/softwareLog.js",
    width: 920,
    height: 620,
  },
];

async function captureOne(target) {
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
  await win.loadURL(`app://bundle/${target.name}.html`);
  // 等待挂载 + 首帧绘制
  await new Promise((r) => setTimeout(r, 900));
  const image = await win.capturePage();
  const outPath = path.join(OUT_DIR, `rendered-${target.name}.png`);
  fs.writeFileSync(outPath, image.toPNG());
  win.close();
  return outPath;
}

app.whenReady().then(async () => {
  registerAssetProtocol();
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const saved = [];
  for (const target of TARGETS) {
    try {
      saved.push(await captureOne(target));
    } catch (err) {
      console.log("CAPTURE_ERROR " + target.name + " " + String(err));
    }
  }
  console.log("CAPTURE_DONE " + JSON.stringify(saved));
  app.exit(0);
});

app.on("window-all-closed", () => {});
