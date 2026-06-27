"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const mainJs = readText("main.js");
const consoleIpcJs = readText("src/console-ipc.js");
const consolePreloadJs = readText("src/preload/console.js");
const statusView = readText("src/renderer/app/windows/console/views/StatusView.vue");
const utilsJs = readText("tools/utils.js");
const clientStatusJs = readText("tools/client-status.js");
const risks = [];

function expect(condition, id, severity, detail) {
  if (!condition) {
    risks.push({ id, severity, detail });
  }
}

expect(
  /ipcMain\.on\(\s*["']getConnectionStatus["'],\s*handleGetConnectionStatus\)/.test(
    consoleIpcJs,
  ) &&
    /emitConnectionStatus\(event\.sender\)/.test(consoleIpcJs) &&
    /function emitConnectionStatus/.test(utilsJs) &&
    /clientStatus\.emitConnectionStatus/.test(utilsJs) &&
    /target\.send\(\s*["']connectionStatus["']/.test(clientStatusJs),
  "CONNECTION-STATUS-MAIN-SNAPSHOT-MISSING",
  "high",
  "The main process should answer a renderer request with the current local client count, transit connection state, and print busy state.",
);

expect(
  /"getConnectionStatus"/.test(consolePreloadJs) &&
    /"connectionStatus"/.test(consolePreloadJs),
  "CONNECTION-STATUS-PRELOAD-CHANNEL-MISSING",
  "high",
  "The console preload should explicitly allow the request and response channels for the connection status snapshot.",
);

expect(
  /ipc\.send\(\s*["']getConnectionStatus["']/.test(statusView) &&
    /ipc\.on\(\s*["']connectionStatus["']/.test(statusView),
  "CONNECTION-STATUS-RENDERER-SNAPSHOT-MISSING",
  "high",
  "The status view should request an initial status snapshot after registering IPC listeners, so it does not depend only on earlier socket events.",
);

expect(
  /updateConnectionStatus/.test(statusView) &&
    /localClientCount/.test(statusView) &&
    /transitConnected/.test(statusView),
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
  /本地客户端/.test(statusView) &&
    /暂无连接/.test(statusView) &&
    !/本地连接：\s*[\r\n\s]*<span>[\s\S]*\? `已建立/.test(statusView),
  "LOCAL-CONNECTION-LABEL-MISLEADING",
  "medium",
  'The main window should not label external socket client count as "本地连接：未连接", because the local service can be running with zero connected web/plugin clients.',
);

expect(
  /app\.relaunch\(\)/.test(consoleIpcJs) &&
    /保存设置需要重启软件/.test(consoleIpcJs),
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
