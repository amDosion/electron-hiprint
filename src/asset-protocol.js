"use strict";

const { protocol } = require("electron");
const path = require("path");
const fs = require("fs");
const { SCHEME, HOST, assetsRoot } = require("./asset-url");

// app:// 提供静态资源时按扩展名标注 MIME，确保 .js/.css 被正确解析执行。
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json; charset=utf-8",
};

// 必须在 app ready 之前调用：把 app:// 注册为标准 + 安全来源，
// 使其拥有真实 origin（可正确执行 CSP / ES module / fetch），区别于 file:// 的不透明来源。
function registerAssetSchemeAsPrivileged() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

// 把 app://bundle/<path> 解析为 assets/ 下的绝对路径，并做路径穿越防护。
// 返回 null 表示请求非法（主机不符 / 空路径 / 越界），由调用方回 403。
function resolveAssetPath(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${SCHEME}:`) return null;
  // 只接受我们自己的 host，杜绝 app://其它host/... 试探
  if (url.hostname !== HOST) return null;
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  pathname = pathname.replace(/^\/+/, "");
  if (!pathname) return null;
  const root = assetsRoot();
  const resolved = path.resolve(root, pathname);
  // 穿越防护：解析后必须仍在 assets/ 根之内（杜绝 ../ 逃逸到应用其它目录）
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

// 注册 app:// 的请求处理器。只提供 assets/ 下确实存在的文件，其余一律 403/404。
function registerAssetProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const filePath = resolveAssetPath(request.url);
    if (!filePath) {
      return new Response("Forbidden", { status: 403 });
    }
    let stat;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
    if (!stat.isFile()) {
      return new Response("Not Found", { status: 404 });
    }
    let data;
    try {
      data = await fs.promises.readFile(filePath);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";
    return new Response(data, {
      status: 200,
      headers: { "content-type": contentType },
    });
  });
}

module.exports = {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
  // 导出供单测验证路径穿越防护
  resolveAssetPath,
};
