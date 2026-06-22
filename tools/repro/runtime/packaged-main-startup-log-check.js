"use strict";

// Packaged-shape startup smoke for the real main process.
// This covers the path missed by software-log-store-check.js: main.js wires
// electron-log, creates the packaged app window stack, and then emits the
// startup marker that installed-upgrade-smoke.ps1 waits for in SQLite.
//
// Run: npx electron tools/repro/runtime/packaged-main-startup-log-check.js
// Contract: stdout prints MAIN_STARTUP_LOG_RESULT <json>; failed=false exits 0.

const fs = require("fs");
const os = require("os");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { app, BrowserWindow } = require("electron");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const rawConsoleLog = console.log.bind(console);
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hiprint-main-start-"));
const userDataDir = path.join(tmpRoot, "UserData");
const appDataDir = path.join(tmpRoot, "AppData");
const resourcesPath = path.join(tmpRoot, "resources");
const unpackedAssetsDir = path.join(resourcesPath, "app.asar.unpacked");
const dbPath = path.join(userDataDir, "database.sqlite");

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(appDataDir, { recursive: true });
fs.mkdirSync(unpackedAssetsDir, { recursive: true });

process.env.HIPRINT_USER_DATA_DIR = userDataDir;
process.env.APPDATA = appDataDir;

if (fs.existsSync(path.join(REPO_ROOT, "assets"))) {
  fs.cpSync(path.join(REPO_ROOT, "assets"), path.join(unpackedAssetsDir, "assets"), {
    recursive: true,
  });
}

Object.defineProperty(app, "isPackaged", { value: true, configurable: true });
Object.defineProperty(process, "resourcesPath", {
  value: resourcesPath,
  configurable: true,
});
app.getAppPath = () => REPO_ROOT;
app.requestSingleInstanceLock = () => true;
app.setPath("userData", userDataDir);
app.disableHardwareAcceleration();

function dbAll(sql, params = []) {
  return new Promise((resolve) => {
    if (!fs.existsSync(dbPath)) return resolve([]);
    const db = new sqlite3.Database(dbPath);
    db.all(sql, params, (err, rows) => {
      db.close(() => resolve(err || !Array.isArray(rows) ? [] : rows));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStartupLog(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await dbAll(
      "SELECT id, ts, level, msg FROM software_logs WHERE msg LIKE '%Electron-hiprint 启动%' ORDER BY id DESC LIMIT 1",
    );
    if (rows.length > 0) return rows[0];
    await wait(250);
  }
  return null;
}

async function readDiagnostics() {
  const tables = await dbAll(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  );
  const recent = await dbAll(
    "SELECT id, ts, level, msg FROM software_logs ORDER BY id DESC LIMIT 20",
  );
  return {
    dbExists: fs.existsSync(dbPath),
    dbPath,
    dbSize: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    tables: tables.map((row) => row.name),
    recent,
  };
}

function closeDatabase() {
  return new Promise((resolve) => {
    try {
      const databaseModulePath = path.join(REPO_ROOT, "tools/database");
      const cached = require.cache[require.resolve(databaseModulePath)];
      const db = cached && cached.exports;
      if (db && typeof db.close === "function") {
        db.close(() => resolve());
        return;
      }
    } catch {}
    resolve();
  });
}

async function finish(result) {
  result.failed = Boolean(result.failed);
  rawConsoleLog("MAIN_STARTUP_LOG_RESULT " + JSON.stringify(result));
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.destroy();
    } catch {}
  }
  await closeDatabase();
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {}
  app.exit(result.failed ? 1 : 0);
}

const killTimer = setTimeout(async () => {
  await finish({
    failed: true,
    reason: "timeout",
    diagnostics: await readDiagnostics(),
  });
}, 20000);
killTimer.unref && killTimer.unref();

try {
  require(path.join(REPO_ROOT, "main.js"));
} catch (error) {
  clearTimeout(killTimer);
  finish({
    failed: true,
    reason: "require-main-failed",
    error: String((error && error.stack) || error),
  });
}

app.whenReady().then(async () => {
  const startupLog = await waitForStartupLog(12000);
  clearTimeout(killTimer);
  if (!startupLog) {
    await finish({
      failed: true,
      reason: "startup-log-missing",
      diagnostics: await readDiagnostics(),
    });
    return;
  }
  await finish({
    failed: false,
    startupLog,
    diagnostics: await readDiagnostics(),
  });
});

app.on("window-all-closed", () => {});
