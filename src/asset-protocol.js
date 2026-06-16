"use strict";

const { protocol, net } = require("electron");
const path = require("path");
const { pathToFileURL } = require("node:url");
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

    // 用 net.fetch 转发到 file://，由 Electron 网络栈原生流式读取本地文件，
    // 不再在主进程事件循环里同步把 MB 级 HTML 读进 Buffer 再构造 Response——
    // 后者在运行期主进程繁忙（中转 socket + 持续写 sqlite）+ 大文件 + 并发打开时，
    // 会令窗口页面加载间歇 ERR_FAILED / 极慢（见
    // .investigations/2026-06-14-log-window-spinner-overlay-timing.md）。
    // 路径穿越已由 resolveAssetPath 校验，这里只服务 assets/ 内的合法文件。
    const isDocument = filePath.toLowerCase().endsWith(".html");
    const startedAt = isDocument ? Date.now() : 0;

    let upstream;
    try {
      upstream = await net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      if (isDocument) {
        console.error(
          `app:// 提供 ${path.basename(filePath)} 失败 ${Date.now() -
            startedAt}ms ${error && error.message ? error.message : error}`,
        );
      }
      return new Response("Not Found", { status: 404 });
    }

    if (isDocument) {
      console.log(
        `app:// 提供 ${path.basename(filePath)} ${Date.now() -
          startedAt}ms status=${upstream.status}`,
      );
    }

    // 显式按扩展名覆盖 content-type：Windows 下 file:// 的 .js MIME 可能取自系统
    // 注册表（常为 text/plain），会令 app:// 这个 standard+secure 源下的 ES module
    // 拒绝执行；故对已知类型强制设置正确 MIME。body 保持 ReadableStream 流式，不入主进程内存。
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext];
    if (contentType) {
      const headers = new Headers(upstream.headers);
      headers.set("content-type", contentType);
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      });
    }
    return upstream;
  });
}

module.exports = {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
  // 导出供单测验证路径穿越防护
  resolveAssetPath,
};
