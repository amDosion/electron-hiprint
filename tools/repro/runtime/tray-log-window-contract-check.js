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
  printLog: readText("src/printLog.js"),
  softwareLog: readText("src/softwareLog.js"),
  loadingView: readText("src/loading-view.js"),
};

const risks = [];

function expect(condition, id, severity, detail) {
  if (!condition) {
    risks.push({ id, severity, detail });
  }
}

function expectLoadingBeforeWindowLoad(fileKey, assetName) {
  const text = files[fileKey];
  const attachIndex = text.indexOf("attachLoadingView(");
  const loadIndex = text.indexOf(`getAssetUrl("${assetName}")`);
  expect(
    attachIndex >= 0 && loadIndex >= 0 && attachIndex < loadIndex,
    `${fileKey.toUpperCase()}-LOADING-VIEW-NOT-ATTACHED-BEFORE-LOAD`,
    "high",
    `${fileKey} should attach the loading WebContentsView before loading ${assetName}.`,
  );
}

function expectIpcBeforeWindowLoad(fileKey, initCall, assetName) {
  const text = files[fileKey];
  const initIndex = text.indexOf(initCall);
  const loadIndex = text.indexOf(`getAssetUrl("${assetName}")`);
  expect(
    initIndex >= 0 && loadIndex >= 0 && initIndex < loadIndex,
    `${fileKey.toUpperCase()}-IPC-NOT-READY-BEFORE-LOAD`,
    "high",
    `${fileKey} should register IPC handlers before loading ${assetName}; the renderer requests data as soon as it mounts.`,
  );
}

expectLoadingBeforeWindowLoad("printLog", "printLog.html");
expectLoadingBeforeWindowLoad("softwareLog", "softwareLog.html");
expectIpcBeforeWindowLoad("printLog", "initPrintLogEvent();", "printLog.html");
expectIpcBeforeWindowLoad(
  "softwareLog",
  "initSoftwareLogEvent();",
  "softwareLog.html",
);

expect(
  /await\s+PRINT_LOG_WINDOW\.loadURL\(\s*getAssetUrl\("printLog\.html"\)\s*\)/.test(
    files.printLog,
  ),
  "PRINTLOG-LOADURL-NOT-AWAITED",
  "medium",
  "Print log window creation should observe app:// load failures instead of leaving them as unhandled async work.",
);
expect(
  /await\s+SOFTWARE_LOG_WINDOW\.loadURL\(\s*getAssetUrl\("softwareLog\.html"\)\s*\)/.test(
    files.softwareLog,
  ),
  "SOFTWARELOG-LOADURL-NOT-AWAITED",
  "medium",
  "Software log window creation should observe app:// load failures instead of leaving them as unhandled async work.",
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
    /softwareLogSetup\(\)/.test(files.main) &&
    /printLogSetup\(\)/.test(files.main),
  "TRAY-LOG-WINDOW-ENTRIES-MISSING",
  "medium",
  "The tray menu should keep direct entries for software logs and print records.",
);

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
