"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const mainJs = readText("main.js");
const preloadIndexJs = readText("src/preload/index.js");
// 渲染层迁移到 Vue SFC 后，主窗口真源是 App.vue；assets/index.html 已是 Vite 压缩单文件
// 产物（标识符被改名/内联），对其做源级断言会假阳性，故渲染层检查一律读 SFC 源。
const indexAppVue = readText("src/renderer/app/windows/index/App.vue");
const utilsJs = readText("tools/utils.js");
const setJs = readText("src/set.js");
const risks = [];

function expect(condition, id, severity, detail) {
  if (!condition) {
    risks.push({ id, severity, detail });
  }
}

expect(
  /ipcMain\.on\(\s*["']getConnectionStatus["']/.test(mainJs) &&
    /emitConnectionStatus\(event\.sender\)/.test(mainJs) &&
    /function emitConnectionStatus/.test(utilsJs) &&
    /target\.send\(\s*["']connectionStatus["']/.test(utilsJs),
  "CONNECTION-STATUS-MAIN-SNAPSHOT-MISSING",
  "high",
  "The main process should answer a renderer request with the current local client count, transit connection state, and print busy state.",
);

expect(
  /"getConnectionStatus"/.test(preloadIndexJs) &&
    /"connectionStatus"/.test(preloadIndexJs),
  "CONNECTION-STATUS-PRELOAD-CHANNEL-MISSING",
  "high",
  "The index preload should explicitly allow the request and response channels for the connection status snapshot.",
);

expect(
  /ipc\.send\(\s*["']getConnectionStatus["']/.test(indexAppVue) &&
    /ipc\.on\(\s*["']connectionStatus["']/.test(indexAppVue),
  "CONNECTION-STATUS-RENDERER-SNAPSHOT-MISSING",
  "high",
  "The main window should request an initial status snapshot after registering IPC listeners, so it does not depend only on earlier socket events.",
);

expect(
  /updateConnectionStatus/.test(indexAppVue) &&
    /localClientCount/.test(indexAppVue) &&
    /transitConnected/.test(indexAppVue),
  "CONNECTION-STATUS-RENDERER-MERGE-MISSING",
  "high",
  "The renderer should merge the snapshot fields into the same state used by subsequent socket events.",
);

expect(
  /connect_error/.test(utilsJs) && /emitConnectionStatus/.test(utilsJs),
  "TRANSIT-RUNTIME-CONNECT-ERROR-UNOBSERVED",
  "medium",
  "The runtime transit socket should report connection failures and emit a false status, not leave the UI at its default without diagnostics.",
);

expect(
  /本地客户端|外部连接/.test(indexAppVue) &&
    !/本地连接：\s*[\r\n\s]*<span>[\s\S]*\? `已建立/.test(indexAppVue),
  "LOCAL-CONNECTION-LABEL-MISLEADING",
  "medium",
  'The main window should not label external socket client count as "本地连接：未连接", because the local service can be running with zero connected web/plugin clients.',
);

expect(
  /app\.relaunch\(\)/.test(setJs) && /保存设置需要重启软件/.test(setJs),
  "SETTINGS-TRANSIT-RESTART-CONTRACT-MISSING",
  "low",
  "Saving transit settings should keep the explicit restart contract unless runtime reconnect is implemented and verified.",
);

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
