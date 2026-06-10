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
function assetsRoot() {
  return path.join(app.getAppPath(), "assets");
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

// 打印引擎窗口（render.html / print.html）的 CSP 内置 file: scheme、围绕 file:// 设计，
// 保留 file:// 加载以维持其既有行为；不纳入 app:// 迁移范围。
function getFileAssetUrl(...assetPath) {
  return pathToFileURL(path.join(assetsRoot(), ...assetPath)).href;
}

module.exports = {
  SCHEME,
  HOST,
  assetsRoot,
  getAssetUrl,
  getFileAssetUrl,
};
