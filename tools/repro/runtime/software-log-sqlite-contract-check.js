"use strict";

// Static regression for the software-log sqlite-only contract.
// Run after npm run build:renderer so generated console assets are checked too.

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "../../..");

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

// 去 vite-plugin-singlefile 后渲染层改为分块构建：窗口 HTML 只剩 <script src> 外链，
// 应用代码落在 assets/assets/<chunk>.{js,css}。console SPA 的 route 代码会拆成
// Console/AppShell 与各 view chunk，所以构建产物契约需要合并相关 chunk 文本。
function readBuiltBundle(htmlRel, chunkPatterns) {
  let text = read(htmlRel);
  const chunkDir = path.join(REPO_ROOT, "assets", "assets");
  if (fs.existsSync(chunkDir)) {
    for (const name of fs.readdirSync(chunkDir)) {
      if (
        (name.endsWith(".js") || name.endsWith(".css")) &&
        chunkPatterns.some((pattern) => pattern.test(name))
      ) {
        text += "\n" + fs.readFileSync(path.join(chunkDir, name), "utf8");
      }
    }
  }
  return text;
}

function contains(text, pattern) {
  return pattern instanceof RegExp
    ? pattern.test(text)
    : text.includes(pattern);
}

const files = {
  main: read("main.js"),
  consoleIpc: read("src/console-ipc.js"),
  softwareLogStore: read("src/software-log-store.js"),
  utils: read("tools/utils.js"),
  database: read("tools/database.js"),
  softwareLogVue: read(
    "src/renderer/app/windows/console/views/SoftwareLogView.vue",
  ),
  settingsVue: read("src/renderer/app/windows/console/views/SettingsView.vue"),
  softwareLogSmoke: read(
    "tools/repro/runtime/softwarelog-window-render-smoke.js",
  ),
  packagedMainStartupSmoke: read(
    "tools/repro/runtime/packaged-main-startup-log-check.js",
  ),
  loadingSmoke: read("tools/repro/runtime/loading-view-lifecycle-check.js"),
  setSmoke: read("tools/repro/runtime/set-window-render-smoke.js"),
  assetsConsole: readBuiltBundle("assets/console.html", [
    /^console-/,
    /^StatusView-/,
    /^SettingsView-/,
    /^PrintLogView-/,
    /^SoftwareLogView-/,
    /^ConfirmDialog-/,
    /^bridge-/,
  ]),
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
expect(
  "main-applies-user-data-override-before-sqlite-store",
  files.main.includes("HIPRINT_USER_DATA_DIR") &&
    files.main.indexOf("applyUserDataPathOverride();") >= 0 &&
    files.main.indexOf("applyUserDataPathOverride();") <
      files.main.indexOf('require("./src/software-log-store")'),
);
expectAbsent("main-has-no-file-log-path", "main", [
  "transports.file.resolvePathFn",
  "YYYY-MM-DD.log",
  'store.get("logPath")',
  "store.get('logPath')",
]);

expect(
  "database-exposes-path",
  /getDatabasePath\s*=\s*\(\)\s*=>\s*dbPath/.test(files.database),
);
expect(
  "database-exposes-schema-ready",
  /const\s+schemaReady\s*=\s*new\s+Promise/.test(files.database) &&
    /whenReady\s*=\s*\(\)\s*=>\s*schemaReady/.test(files.database) &&
    /finishSchemaReady/.test(files.database),
);
expect(
  "database-indexes-software-tail-read",
  /idx_software_logs_day_id[\s\S]*ON software_logs\(day, id DESC\)/.test(
    files.database,
  ),
);
expect(
  "database-indexes-print-latest-read",
  /idx_print_logs_timestamp_id[\s\S]*ON print_logs\(timestamp DESC, id DESC\)/.test(
    files.database,
  ),
);
expect(
  "database-indexes-print-template-status-read",
  /idx_print_logs_template_timestamp_id[\s\S]*ON print_logs\(templateId, timestamp DESC, id DESC\)/.test(
    files.database,
  ),
);
expect(
  "software-log-store-exposes-database-path",
  /getDatabasePath/.test(files.softwareLogStore),
);
expect(
  "software-log-store-waits-for-schema-ready-before-insert",
  /const\s+schemaReady\s*=/.test(files.softwareLogStore) &&
    /db\.whenReady/.test(files.softwareLogStore) &&
    /schemaReady\.then\([\s\S]*INSERT INTO software_logs/.test(
      files.softwareLogStore,
    ),
);
expect(
  "software-log-store-reports-write-errors-without-console-recursion",
  /process\.stderr\.write/.test(files.softwareLogStore) &&
    /reportedWriteError/.test(files.softwareLogStore),
);
expectAbsent(
  "software-log-store-has-no-text-fallback-comment",
  "softwareLogStore",
  ["文本 transport", "text transport"],
);

expect(
  "console-ipc-opens-database-directory",
  /shell\.openPath\(path\.dirname\(softwareLogStore\.getDatabasePath\(\)\)\)/.test(
    files.consoleIpc,
  ),
);
expectAbsent("console-ipc-has-no-file-log-path", "consoleIpc", [
  'store.get("logPath")',
  "store.get('logPath')",
  'app.getPath("logs")',
  "app.getPath('logs')",
  "日志保存路径",
]);

expect(
  "settings-save-drops-stale-log-path",
  /delete\s+nextData\.logPath/.test(files.consoleIpc),
);
expectAbsent("settings-main-no-log-path-validation", "consoleIpc", [
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
  'String(date) + ".log"',
]);
expectAbsent("settings-smoke-no-log-path-fixture", "setSmoke", ["logPath"]);
expect(
  "software-log-smoke-loads-console-route",
  files.softwareLogSmoke.includes("console.html#/software-log") &&
    files.softwareLogSmoke.includes("src/preload/console.js"),
);
expect(
  "software-log-smoke-asserts-sqlite-footer",
  (files.softwareLogSmoke.includes("sqlite/software_logs") ||
    files.softwareLogSmoke.includes("sqlite\\/software_logs")) &&
    files.softwareLogSmoke.includes("file-log-footer-present"),
);
expectAbsent("software-log-smoke-no-old-window-paths", "softwareLogSmoke", [
  "software" + "Log.html",
  "src/preload/software" + "Log.js",
  'String(date) + ".log"',
]);
expect(
  "packaged-main-startup-smoke-loads-real-main-and-asserts-sqlite-marker",
  files.packagedMainStartupSmoke.includes('require(path.join(REPO_ROOT, "main.js"))') &&
    files.packagedMainStartupSmoke.includes("HIPRINT_USER_DATA_DIR") &&
    files.packagedMainStartupSmoke.includes("Electron-hiprint 启动") &&
    files.packagedMainStartupSmoke.includes("MAIN_STARTUP_LOG_RESULT"),
);

expectAbsent(
  "built-console-asset-no-file-source-wording",
  "assetsConsole",
  ["…/logs/", "暂无日志文件", "打开文件夹"],
);
expect(
  "built-console-asset-has-sqlite-source",
  files.assetsConsole.includes("sqlite/software_logs"),
);
expectAbsent("built-console-asset-no-log-path-field", "assetsConsole", [
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
