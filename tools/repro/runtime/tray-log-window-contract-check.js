"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function indexOfOrMinusOne(text, pattern) {
  const match = text.match(pattern);
  return match ? match.index : -1;
}

const files = {
  main: readText("main.js"),
  appWindow: readText("src/app-window.js"),
  consoleIpc: readText("src/console-ipc.js"),
  consolePreload: readText("src/preload/console.js"),
  consoleRouter: readText("src/renderer/app/windows/console/router.ts"),
  loadingView: readText("src/loading-view.js"),
};

const risks = [];

function expect(condition, id, severity, detail) {
  if (!condition) {
    risks.push({ id, severity, detail });
  }
}

function expectRoute(pathname, name) {
  expect(
    files.consoleRouter.includes(`path: "${pathname}"`) &&
      files.consoleRouter.includes(`name: "${name}"`),
    `CONSOLE-ROUTE-${name.toUpperCase()}-MISSING`,
    "high",
    `Console router should expose ${pathname} for the ${name} view.`,
  );
}

function expectBridge(bridgeName, requiredText) {
  expect(
    files.consolePreload.includes(`"${bridgeName}"`) &&
      requiredText.every((text) => files.consolePreload.includes(text)),
    `CONSOLE-PRELOAD-${bridgeName.toUpperCase()}-BRIDGE-MISSING`,
    "high",
    `src/preload/console.js should expose ${bridgeName} with the legacy-compatible methods/channels used by the console SPA.`,
  );
}

const attachIndex = files.appWindow.indexOf("attachLoadingView(");
const loadIndex = files.appWindow.indexOf('getAssetUrl("console.html")');
expect(
  attachIndex >= 0 && loadIndex >= 0 && attachIndex < loadIndex,
  "CONSOLE-LOADING-VIEW-NOT-ATTACHED-BEFORE-LOAD",
  "high",
  "The console BrowserWindow should attach the loading WebContentsView before loading console.html.",
);

expect(
  /loadURL\(\s*getAssetUrl\("console\.html"\)\s*\)\s*\.catch\(/.test(
    files.appWindow,
  ),
  "CONSOLE-LOADURL-FAILURE-NOT-OBSERVED",
  "medium",
  "Console window creation should observe app:// load failures instead of leaving them as unhandled async work.",
);

expect(
  /once\(\s*["']dom-ready["']\s*,\s*removeLoadingView\s*\)/.test(
    files.loadingView,
  ) &&
    /once\(\s*["']did-finish-load["']\s*,\s*removeLoadingView\s*\)/.test(
      files.loadingView,
    ) &&
    /once\(\s*["']did-fail-load["']\s*,\s*removeLoadingView\s*\)/.test(
      files.loadingView,
    ) &&
    /isRemoved:\s*\(\)\s*=>\s*removed/.test(files.loadingView),
  "LOADING-VIEW-LIFECYCLE-CONTRACT-BROKEN",
  "high",
  "attachLoadingView should remove the overlay on successful or failed target-window load and expose isRemoved for runtime smoke checks.",
);

expectRoute("/status", "status");
expectRoute("/settings/basic", "settingsBasic");
expectRoute("/print-log", "printLog");
expectRoute("/software-log", "softwareLog");

expectBridge("hiprintPrintLog", [
  '"request-logs"',
  '"clear-logs"',
  '"reprint"',
  "onPrintLogs",
]);
expectBridge("hiprintSoftwareLog", [
  '"software-log:list-dates"',
  '"software-log:read"',
  '"software-log:open-folder"',
  '"software-log:clear"',
]);
expectBridge("hiprintConsole", ['"console:navigate"', "onNavigate"]);

expect(
  /ipcMain\.on\("request-logs",\s*fetchPrintLogs\)/.test(files.consoleIpc) &&
    /ipcMain\.on\("clear-logs",\s*clearPrintLogs\)/.test(files.consoleIpc) &&
    /ipcMain\.on\("reprint",\s*rePrint\)/.test(files.consoleIpc),
  "CONSOLE-PRINTLOG-IPC-MISSING",
  "high",
  "Console IPC should register the print-log request, clear, and reprint channels before the console view uses them.",
);

expect(
  /ipcMain\.handle\("software-log:list-dates"/.test(files.consoleIpc) &&
    /ipcMain\.handle\("software-log:read"/.test(files.consoleIpc) &&
    /ipcMain\.handle\("software-log:clear"/.test(files.consoleIpc) &&
    /ipcMain\.on\("software-log:open-folder",\s*openFolder\)/.test(
      files.consoleIpc,
    ),
  "CONSOLE-SOFTWARELOG-IPC-MISSING",
  "high",
  "Console IPC should register the software-log list/read/clear/open-folder channels before the console view uses them.",
);

const restartLabelIndex = files.main.indexOf('label: "重启软件"');
const exitLabelIndex = files.main.indexOf('label: "退出"');
expect(
  /function\s+restartApp\s*\(\)\s*\{[\s\S]*?app\.relaunch\(\)[\s\S]*?helper\.appQuit\(\)[\s\S]*?\}/.test(
    files.main,
  ),
  "TRAY-RESTART-ACTION-MISSING",
  "high",
  "Tray restart should relaunch the app and then use the normal appQuit cleanup path.",
);
expect(
  restartLabelIndex >= 0 &&
    exitLabelIndex >= 0 &&
    restartLabelIndex < exitLabelIndex &&
    /label:\s*"重启软件"[\s\S]{0,180}click:\s*\(\)\s*=>\s*\{[\s\S]{0,120}restartApp\(\)/.test(
      files.main,
    ),
  "TRAY-RESTART-MENU-MISSING",
  "high",
  "The tray context menu should expose a Restart Software item before Exit.",
);
expect(
  indexOfOrMinusOne(files.main, /label:\s*"软件日志"/) >= 0 &&
    indexOfOrMinusOne(files.main, /label:\s*"打印记录"/) >= 0 &&
    /showConsole\("\/software-log"\)/.test(files.main) &&
    /showConsole\("\/print-log"\)/.test(files.main),
  "TRAY-LOG-WINDOW-ENTRIES-MISSING",
  "medium",
  "The tray menu should route software logs and print records into the console SPA routes.",
);

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
