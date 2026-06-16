"use strict";

const { app } = require("electron");
const path = require("path");
const { pathToFileURL } = require("node:url");

// 应用 UI 窗口（index/set/printLog/softwareLog/loading）通过自定义 app:// 协议加载，
// 而非 file://。app:// 注册为标准 + 安全来源（见 asset-protocol.js），拥有真实 origin，
// 可正确执行 CSP 与 ES module，且 handler 严格限定只从应用内 assets/ 目录提供文件，
// 不暴露任意本地文件系统访问——比 file:// 的不透明来源更安全。
const SCHEME = "app";
const HOST = "bundle";

// assets/ 根：app:// handler 与 URL 构造共用同一基准。
// 打包态指向 app.asar.unpacked，避免 Electron 42 访问 app.asar 内静态资源时
// 触发内部 fs.Stats DEP0180 告警。
function assetsRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app.asar.unpacked", "assets");
  }
  return path.join(app.getAppPath(), "assets");
}

// 隐藏打印/渲染窗口仍用 file://，但打包态必须避开 app.asar 内路径。
// Electron 42 从 file:// 读取 app.asar 内文件时会触发内部 lstat 兼容层的
// DEP0180 警告；对应文件由 electron-builder asarUnpack 解包到普通目录。
function fileAssetsRoot() {
  return assetsRoot();
}

// 构造 app://bundle/<asset> URL（各段做 URI 编码，杜绝特殊字符注入）。
function getAssetUrl(...assetPath) {
  const encoded = assetPath
    .join("/")
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  return `${SCHEME}://${HOST}/${encoded}`;
}

// print.html 的 CSP 内置 file: scheme、围绕 file:// 设计，保留 file:// 加载以维持既有行为。
// （render.html 已随插件 ESM 化改走 app://，见 src/render.js。）
function getFileAssetUrl(...assetPath) {
  return pathToFileURL(path.join(fileAssetsRoot(), ...assetPath)).href;
}

module.exports = {
  SCHEME,
  HOST,
  assetsRoot,
  fileAssetsRoot,
  getAssetUrl,
  getFileAssetUrl,
};
