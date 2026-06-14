"use strict";

// Static regression for the software-log sqlite-only contract.
// Run after npm run build:renderer so generated assets are checked too.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../../..");

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function contains(text, pattern) {
  return pattern instanceof RegExp ? pattern.test(text) : text.includes(pattern);
}

const files = {
  main: read("main.js"),
  softwareLogMain: read("src/softwareLog.js"),
  softwareLogStore: read("src/software-log-store.js"),
  settingsMain: read("src/set.js"),
  utils: read("tools/utils.js"),
  database: read("tools/database.js"),
  softwareLogVue: read("src/renderer/app/windows/softwareLog/App.vue"),
  settingsVue: read("src/renderer/app/windows/set/App.vue"),
  softwareLogSmoke: read("tools/repro/runtime/softwarelog-window-render-smoke.js"),
  loadingSmoke: read("tools/repro/runtime/loading-view-lifecycle-check.js"),
  setSmoke: read("tools/repro/runtime/set-window-render-smoke.js"),
  assetsSoftwareLog: read("assets/softwareLog.html"),
  assetsSet: read("assets/set.html"),
};

const checks = [];

function expect(name, ok, details) {
  checks.push({ name, ok: Boolean(ok), details });
}

function expectAbsent(name, fileName, patterns) {
  const hits = patterns.filter((pattern) => contains(files[fileName], pattern));
  expect(name, hits.length === 0, { fileName, hits: hits.map(String) });
}

expect(
  "main-disables-electron-log-file-transport",
  /electronLog\.transports\.file\.level\s*=\s*false/.test(files.main),
);
expect(
  "main-keeps-sqlite-transport",
  /electronLog\.transports\.sqlite\s*=\s*softwareLogStore\.appendFromTransport/.test(
    files.main,
  ),
);
expectAbsent("main-has-no-file-log-path", "main", [
  "transports.file.resolvePathFn",
  "YYYY-MM-DD.log",
  "store.get(\"logPath\")",
  "store.get('logPath')",
]);

expect(
  "database-exposes-path",
  /getDatabasePath\s*=\s*\(\)\s*=>\s*dbPath/.test(files.database),
);
expect(
  "software-log-store-exposes-database-path",
  /getDatabasePath/.test(files.softwareLogStore),
);
expectAbsent("software-log-store-has-no-text-fallback-comment", "softwareLogStore", [
  "文本 transport",
  "text transport",
]);

expect(
  "software-log-window-opens-database-directory",
  /shell\.openPath\(path\.dirname\(softwareLogStore\.getDatabasePath\(\)\)\)/.test(
    files.softwareLogMain,
  ),
);
expectAbsent("software-log-window-has-no-log-path", "softwareLogMain", [
  "logPath",
  "store.get",
  "app.getPath(\"logs\")",
  "app.getPath('logs')",
]);

expect(
  "settings-save-drops-stale-log-path",
  /delete\s+nextData\.logPath/.test(files.settingsMain),
);
expectAbsent("settings-main-no-log-path-validation", "settingsMain", [
  "data.logPath",
  "日志保存路径",
]);
expectAbsent("settings-schema-no-log-path", "utils", ["logPath:"]);

expect(
  "software-log-ui-shows-sqlite-source",
  files.softwareLogVue.includes("sqlite/software_logs"),
);
expectAbsent("software-log-ui-no-file-log-wording", "softwareLogVue", [
  "…/logs/",
  "date + '.log'",
  "暂无日志文件",
  "打开文件夹",
]);
expectAbsent("settings-ui-no-log-path-field", "settingsVue", [
  "logPath",
  "日志路径",
  "日志存储",
]);

expectAbsent("runtime-smokes-no-log-path-fixtures", "loadingSmoke", [
  "logPath",
  "String(date) + \".log\"",
]);
expectAbsent("settings-smoke-no-log-path-fixture", "setSmoke", ["logPath"]);
expect(
  "software-log-smoke-asserts-sqlite-footer",
  (files.softwareLogSmoke.includes("sqlite/software_logs") ||
    files.softwareLogSmoke.includes("sqlite\\/software_logs")) &&
    files.softwareLogSmoke.includes("file-log-footer-present"),
);
expectAbsent("software-log-smoke-no-log-file-fixture", "softwareLogSmoke", [
  "String(date) + \".log\"",
]);

expectAbsent("built-software-log-asset-no-file-source-wording", "assetsSoftwareLog", [
  "…/logs/",
  "暂无日志文件",
  "打开文件夹",
]);
expect(
  "built-software-log-asset-has-sqlite-source",
  files.assetsSoftwareLog.includes("sqlite/software_logs"),
);
expectAbsent("built-settings-asset-no-log-path-field", "assetsSet", [
  "logPath",
  "日志路径",
  "日志存储",
]);

const failed = checks.filter((check) => !check.ok);
console.log(
  JSON.stringify(
    {
      failed: failed.length > 0,
      checks,
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  process.exitCode = 1;
}
