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
  BrowserView,
  ipcMain,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const childProcess = require("node:child_process");
const https = require("node:https");
const fs = require("node:fs");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { store } = require("../tools/utils");
const helper = require("./helper");
const {
  GITHUB_LATEST_RELEASE_URL,
  compareVersions,
  downloadVerifiedAsset,
  getLatestGithubRelease,
  getReleaseVersion,
  selectReleaseAsset,
} = require("./online-update");

let onlineUpgradeInProgress = false;

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
      preload: path.join(__dirname, "preload/set.js"),
    },
  };

  // 创建设置窗口
  SET_WINDOW = new BrowserWindow(windowOptions);

  // 添加加载页面 解决白屏的问题
  loadingView(windowOptions);

  // 加载设置渲染进程页面
  const setHtmlUrl = path.join("file://", app.getAppPath(), "assets/set.html");
  SET_WINDOW.webContents.loadURL(setHtmlUrl);

  // 未打包时打开开发者工具
  if (!app.isPackaged) {
    SET_WINDOW.webContents.openDevTools();
  }

  // 绑定窗口事件
  initSetEvent();

  // 监听退出，移除所有事件
  SET_WINDOW.on("closed", removeEvent);

  SET_WINDOW.webContents.on("did-finish-load", () => {
    const downloadedVersions = getDownloadedVersions();
    SET_WINDOW.webContents.send("downloadedVersions", downloadedVersions);
  });

  return SET_WINDOW;
}

/**
 * @description: 加载等待页面，解决主窗口白屏问题
 * @param {Object} windowOptions 主窗口配置
 * @return {void}
 */
function loadingView(windowOptions) {
  const loadingBrowserView = new BrowserView();
  SET_WINDOW.setBrowserView(loadingBrowserView);
  loadingBrowserView.setBounds({
    x: 0,
    y: 0,
    width: windowOptions.width,
    height: windowOptions.height,
  });

  const loadingHtml = path.join(
    "file://",
    app.getAppPath(),
    "assets/loading.html",
  );
  loadingBrowserView.webContents.loadURL(loadingHtml);

  // 设置窗口 dom 加载完毕，移除 loadingBrowserView
  SET_WINDOW.webContents.on("dom-ready", async (event) => {
    loadingBrowserView.webContents.destroy();
    SET_WINDOW.removeBrowserView(loadingBrowserView);
  });
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
 * @description: 渲染进程触发下载插件
 * @param {IpcMainEvent} event
 * @param {Object} data 客户端内部渲染插件版本号
 * @return {void}
 */
function downloadPlugin(event, data) {
  const fileList = ["vue-plugin-hiprint.js", "print-lock.css"];
  downloadPluginFiles(data, fileList)
    .then(() => {
      dialog.showMessageBox(SET_WINDOW, {
        type: "info",
        title: "提示",
        message: "插件下载成功！",
        buttons: ["确定"],
        noLink: true,
      });
      const downloadedVersions = getDownloadedVersions();
      SET_WINDOW.webContents.send("downloadedVersions", downloadedVersions);
    })
    .catch(() => {
      dialog.showMessageBox(SET_WINDOW, {
        type: "error",
        title: "提示",
        message: "插件下载失败！",
        buttons: ["确定"],
        noLink: true,
      });
    });
}

function sendOnlineUpdateStatus(status) {
  if (SET_WINDOW && !SET_WINDOW.isDestroyed()) {
    SET_WINDOW.webContents.send("onlineUpdateStatus", status);
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "未知大小";
  return `${(Number(bytes) / 1048576).toFixed(1)} MB`;
}

function launchInstaller(filePath) {
  return new Promise((resolve, reject) => {
    const installer = childProcess.spawn(filePath, ["/S"], {
      detached: true,
      stdio: "ignore",
    });
    installer.once("error", reject);
    installer.once("spawn", () => {
      installer.unref();
      resolve();
    });
  });
}

async function checkOnlineUpgrade() {
  if (onlineUpgradeInProgress) return;
  onlineUpgradeInProgress = true;
  let installerLaunched = false;
  sendOnlineUpdateStatus({
    busy: true,
    state: "checking",
    message: "正在检查客户端更新...",
  });

  try {
    if (!app.isPackaged) {
      await dialog.showMessageBox(SET_WINDOW, {
        type: "info",
        title: "提示",
        message: "开发环境不执行在线升级，请使用安装后的客户端验证。",
        buttons: ["确定"],
        noLink: true,
      });
      return;
    }

    const release = await getLatestGithubRelease();
    const latestVersion = getReleaseVersion(release);
    if (!latestVersion) {
      throw new Error("GitHub Release 缺少有效版本号");
    }

    const currentVersion = app.getVersion();
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      await dialog.showMessageBox(SET_WINDOW, {
        type: "info",
        title: "提示",
        message: `当前已是最新版本：${currentVersion}`,
        buttons: ["确定"],
        noLink: true,
      });
      return;
    }

    const asset = selectReleaseAsset(release, process.platform, process.arch);
    const confirmResult = await dialog.showMessageBox(SET_WINDOW, {
      type: "question",
      title: "发现新版本",
      message: `发现新版本 ${latestVersion}，是否下载并升级？`,
      detail: [
        `当前版本：${currentVersion}`,
        `安装包：${asset.name}`,
        `大小：${formatBytes(asset.size)}`,
        `来源：${GITHUB_LATEST_RELEASE_URL}`,
      ].join("\n"),
      buttons: ["下载并升级", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (confirmResult.response !== 0) {
      return;
    }

    const downloadPath = path.join(app.getPath("temp"), asset.name);
    sendOnlineUpdateStatus({
      busy: true,
      state: "downloading",
      message: `正在下载 ${latestVersion}...`,
    });
    const downloaded = await downloadVerifiedAsset(asset, downloadPath, {
      onProgress: ({ bytes, totalBytes }) => {
        sendOnlineUpdateStatus({
          busy: true,
          state: "downloading",
          message: `正在下载 ${formatBytes(bytes)} / ${formatBytes(totalBytes)}`,
        });
      },
    });

    sendOnlineUpdateStatus({
      busy: true,
      state: "installing",
      message: "安装包校验通过，正在启动升级...",
    });
    await launchInstaller(downloaded.filePath);
    installerLaunched = true;
    setTimeout(() => {
      helper.appQuit();
    }, 500);
  } catch (error) {
    console.error("在线升级失败:", error);
    sendOnlineUpdateStatus({
      busy: false,
      state: "error",
      message: error.message,
    });
    await dialog.showMessageBox(SET_WINDOW, {
      type: "error",
      title: "提示",
      message: `在线升级失败：${error.message}`,
      buttons: ["确定"],
      noLink: true,
    });
  } finally {
    onlineUpgradeInProgress = false;
    if (!installerLaunched) {
      sendOnlineUpdateStatus({
        busy: false,
        state: "idle",
        message: "",
      });
    }
  }
}

function httpsGetBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirects < 3
      ) {
        res.resume();
        const redirectedUrl = new URL(res.headers.location, url).href;
        httpsGetBuffer(redirectedUrl, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败，HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error("下载超时"));
    });
  });
}

async function downloadPluginFiles(version, fileList) {
  const metadataBuffer = await httpsGetBuffer(
    `https://registry.npmmirror.com/vue-plugin-hiprint/${version}`,
  );
  const metadata = JSON.parse(metadataBuffer.toString("utf8"));
  const tarballUrl = metadata.dist && metadata.dist.tarball;
  const integrity = metadata.dist && metadata.dist.integrity;
  if (!tarballUrl || !integrity) {
    throw new Error("插件元数据缺少 tarball 或 integrity");
  }

  const tarballBuffer = await httpsGetBuffer(tarballUrl);
  verifyNpmIntegrity(tarballBuffer, integrity);
  const extractedFiles = extractDistFilesFromTarball(tarballBuffer, fileList);
  const pluginDir = app.isPackaged
    ? path.join(app.getAppPath(), "../", "plugin")
    : path.join(app.getAppPath(), "plugin");
  fs.mkdirSync(pluginDir, { recursive: true });
  fileList.forEach((fileName) => {
    const content = extractedFiles[fileName];
    if (!content) {
      throw new Error(`插件包缺少 dist/${fileName}`);
    }
    const filePath = path.join(pluginDir, `${version}_${fileName}`);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, content, { flag: "wx" });
    fs.renameSync(tempPath, filePath);
  });
}

function verifyNpmIntegrity(buffer, integrity) {
  const [algorithm, expected] = String(integrity).split("-", 2);
  if (!["sha512", "sha384", "sha256"].includes(algorithm) || !expected) {
    throw new Error("插件 integrity 格式不受支持");
  }
  const actual = crypto.createHash(algorithm).update(buffer).digest("base64");
  if (actual !== expected) {
    throw new Error("插件包完整性校验失败");
  }
}

function extractDistFilesFromTarball(tarballBuffer, fileList) {
  const tarBuffer = zlib.gunzipSync(tarballBuffer);
  const wanted = new Set(fileList.map((fileName) => `package/dist/${fileName}`));
  const extracted = {};
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const name = tarBuffer
      .toString("utf8", offset, offset + 100)
      .replace(/\0.*$/, "");
    if (!name) break;
    const sizeText = tarBuffer
      .toString("utf8", offset + 124, offset + 136)
      .replace(/\0.*$/, "")
      .trim();
    const size = parseInt(sizeText, 8) || 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (wanted.has(name)) {
      extracted[path.basename(name)] = Buffer.from(
        tarBuffer.subarray(dataStart, dataEnd),
      );
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return extracted;
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
 * @description: 渲染进程触发弹出消息框
 * @param {IpcMainEvent} event
 * @param {Object} data https://www.electronjs.org/zh/docs/latest/api/dialog#dialogshowmessageboxbrowserwindow-options
 * @return {void}
 */
function showMessageBox(event, data) {
  dialog.showMessageBox(SET_WINDOW, { noLink: true, ...data });
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
  shell.openPath(data);
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

    console.log(data);
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
  ipcMain.on("showMessageBox", showMessageBox);
  ipcMain.on("showOpenDialog", showOpenDialog);
  ipcMain.on("openDirectory", openDirectory);
  ipcMain.on("testTransit", testTransit);
  ipcMain.on("closeSetWindow", closeSetWindow);
  ipcMain.on("downloadPlugin", downloadPlugin);
  ipcMain.on("checkOnlineUpgrade", checkOnlineUpgrade);
  ipcMain.on("getPrintersList", getPrintersList);
}

/**
 * @description: 移除所有事件
 * @return {void}
 */
function removeEvent() {
  ipcMain.removeListener("setConfig", setConfig);
  ipcMain.removeListener("setContentSize", setContentSize);
  ipcMain.removeListener("showMessageBox", showMessageBox);
  ipcMain.removeListener("showOpenDialog", showOpenDialog);
  ipcMain.removeListener("openDirectory", openDirectory);
  ipcMain.removeListener("testTransit", testTransit);
  ipcMain.removeListener("closeSetWindow", closeSetWindow);
  ipcMain.removeListener("downloadPlugin", downloadPlugin);
  ipcMain.removeListener("checkOnlineUpgrade", checkOnlineUpgrade);
  ipcMain.removeListener("getPrintersList", getPrintersList);
  SET_WINDOW = null;
}

function getDownloadedVersions() {
  let pluginDir = path.join(app.getAppPath(), "plugin");
  if (app.isPackaged) {
    pluginDir = path.join(app.getAppPath(), "../", "plugin");
  }
  if (!fs.existsSync(pluginDir)) {
    return [];
  }
  return fs
    .readdirSync(pluginDir)
    .filter((file) => file.endsWith(".js")) // 假设插件文件以 .js 结尾
    .map((file) => file.split("_")[0]); // 提取版本号
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
