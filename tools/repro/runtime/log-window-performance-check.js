"use strict";

// 打点日志窗口打开链路，区分慢在 SQLite、app:// HTML 加载、Vue 挂载，还是 loading overlay 移除。
// 默认读取当前用户安装态数据库：%APPDATA%/electron-hiprint/database.sqlite。
// 运行：npx electron tools/repro/runtime/log-window-performance-check.js
// 输出：PERF_RESULT <json>，failed=false 表示页面和 overlay 都正常完成。

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const REPO_ROOT = path.resolve(__dirname, "../../..");

const { app, BrowserWindow, ipcMain } = require("electron");

app.getAppPath = () => REPO_ROOT;
app.disableHardwareAcceleration();

const {
  registerAssetSchemeAsPrivileged,
  registerAssetProtocol,
} = require(path.join(REPO_ROOT, "src/asset-protocol"));
const { getAssetUrl } = require(path.join(REPO_ROOT, "src/asset-url"));
const { attachLoadingView } = require(path.join(REPO_ROOT, "src/loading-view"));

registerAssetSchemeAsPrivileged();

const dbPath = process.env.HIPRINT_PERF_DB || path.join(
  process.env.APPDATA || "",
  "electron-hiprint",
  "database.sqlite",
);

function now() {
  return Date.now();
}

function elapsed(start) {
  return now() - start;
}

function dbAll(db, sql, params = []) {
  const start = now();
  return new Promise((resolve) => {
    db.all(sql, params, (err, rows) => {
      resolve({
        ms: elapsed(start),
        err: err ? err.message : null,
        rows: Array.isArray(rows) ? rows : [],
      });
    });
  });
}

function installCommonIpc() {
  ipcMain.on("hiprint:store-get", (event, key) => {
    event.returnValue =
      key === "mainTitle" ? "Electron-hiprint" : key === "rePrint" ? 1 : undefined;
  });
  ipcMain.on("hiprint:app-version", (event) => {
    event.returnValue = "perf-check";
  });
  ipcMain.on("hiprint:settings-snapshot", (event) => {
    event.returnValue = {
      port: 17521,
      token: "",
      closeType: "tray",
      pdfPath: "C:/ProgramData/hiprint/pdf",
      defaultPrinter: "",
      exportDirectory: { enabled: false },
    };
  });
  ipcMain.on("clear-logs", () => {});
  ipcMain.on("reprint", () => {});
  ipcMain.on("software-log:open-folder", () => {});
}

function installDbIpc(result, db) {
  ipcMain.on("request-logs", async (event, payload) => {
    const page = payload && payload.page ? payload.page : {};
    const limit = Number(page.pageSize) || 20;
    const offset = ((Number(page.currentPage) || 1) - 1) * limit;
    const rows = await dbAll(
      db,
      "SELECT id, timestamp, socketId, clientType, printer, templateId, pageNum, status, rePrintAble, errorMessage FROM print_logs ORDER BY timestamp DESC, id DESC LIMIT ? OFFSET ?",
      [limit, offset],
    );
    const total = await dbAll(db, "SELECT COUNT(*) AS total FROM print_logs");
    result.sql.printRows = rows.ms;
    result.sql.printCount = total.ms;
    event.sender.send("print-logs", {
      rows: rows.rows,
      total: Number(total.rows[0] && total.rows[0].total) || 0,
    });
  });

  ipcMain.handle("software-log:list-dates", async () => {
    const query = await dbAll(
      db,
      "SELECT DISTINCT day FROM software_logs WHERE day IS NOT NULL ORDER BY day DESC",
    );
    result.sql.softwareDates = query.ms;
    if (query.err) result.sql.softwareDatesError = query.err;
    return query.rows.map((row) => row.day).filter(Boolean);
  });

  ipcMain.handle("software-log:read", async (_event, date) => {
    const query = await dbAll(
      db,
      "SELECT ts, level, msg FROM software_logs WHERE day = ? ORDER BY id DESC LIMIT 2001",
      [String(date || "")],
    );
    result.sql.softwareRead = query.ms;
    if (query.err) result.sql.softwareReadError = query.err;
    const rows = query.rows.slice(0, 2000).reverse();
    return {
      file: String(date || ""),
      truncated: query.rows.length > 2000,
      lines: rows.map((row) => ({
        ts: row.ts || "",
        level: row.level || "info",
        msg: row.msg || "",
      })),
    };
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check, timeoutMs) {
  const start = now();
  while (elapsed(start) < timeoutMs) {
    const value = await check();
    if (value) return { ok: true, ms: elapsed(start), value };
    await wait(25);
  }
  return { ok: false, ms: elapsed(start), value: null };
}

async function probeWindow({
  name,
  asset,
  hash = "",
  preload,
  bridgeName,
  isIpcSettled,
}) {
  const start = now();
  const step = {
    name,
    hash,
    events: {},
    consoleErrors: [],
    failedLoads: [],
  };
  const win = new BrowserWindow({
    show: false,
    width: 1080,
    height: 600,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload,
    },
  });

  win.webContents.on("dom-ready", () => {
    step.events.domReady = elapsed(start);
  });
  win.webContents.on("did-finish-load", () => {
    step.events.didFinishLoad = elapsed(start);
  });
  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    step.failedLoads.push({ ms: elapsed(start), code, desc, url });
  });
  win.webContents.on("console-message", (...args) => {
    const details = args[0] && typeof args[0] === "object" ? args[0] : {};
    const level = Number.isInteger(details.level) ? details.level : args[1] || 0;
    const message = details.message || args[2] || "";
    if (level >= 3) step.consoleErrors.push({ ms: elapsed(start), message });
  });

  const overlay = attachLoadingView(win, { width: 1080, height: 600 }, getAssetUrl("loading.html"));
  const overlayPoll = waitFor(() => overlay.isRemoved(), 30000).then((probe) => {
    step.events.overlayRemoved = probe.ok ? probe.ms : null;
    return probe;
  });

  try {
    await win.loadURL(`${getAssetUrl(asset)}${hash}`);
    step.events.loadUrlResolved = elapsed(start);
  } catch (error) {
    step.loadUrlError = String((error && error.stack) || error);
  }

  if (typeof isIpcSettled === "function") {
    const ipcSettled = await waitFor(() => (isIpcSettled() ? true : null), 30000);
    step.events.ipcSettled = ipcSettled.ok ? ipcSettled.ms : null;
  }

  const mounted = await waitFor(
    () =>
      win.webContents.executeJavaScript(`(() => {
        const bridgeName = ${JSON.stringify(bridgeName)};
        const rows = document.querySelectorAll('.log-row, .table-wrap table.table tbody tr:not(.empty-row), .el-table__body tr').length;
        const softwareReady = Boolean(document.querySelector('.footer'));
        const printReady = Boolean(document.querySelector('.pagination'))
          && Boolean(document.querySelector('.table-wrap table.table'))
          && (rows > 0 || Boolean(document.querySelector('.empty-row, .el-table__empty-block')));
        const ready = ${JSON.stringify(name)} === 'softwareLog' ? softwareReady : printReady;
        return {
          ready,
          title: document.title,
          origin: location.origin,
          hash: location.hash,
          appChildCount: document.querySelector('#app')?.children.length || 0,
          hasBridge: typeof window[bridgeName] === 'object' && window[bridgeName] !== null,
          rows
        };
      })()`).then((probe) => (probe && probe.ready ? probe : null)),
    30000,
  );
  step.events.vueProbeReady = mounted.ms;
  step.probe = mounted.value;

  await overlayPoll;
  step.totalMs = elapsed(start);
  win.destroy();
  return step;
}

function finish(result) {
  result.failed = Boolean(result.failed);
  console.log("PERF_RESULT " + JSON.stringify(result, null, 2));
  app.exit(result.failed ? 1 : 0);
}

const killTimer = setTimeout(() => {
  finish({ failed: true, reason: "timeout" });
}, 90000);
killTimer.unref && killTimer.unref();

app.whenReady().then(async () => {
  registerAssetProtocol();
  const result = { dbPath, sql: {}, windows: [] };
  const db = new sqlite3.Database(dbPath);
  installCommonIpc();
  installDbIpc(result, db);

  try {
    result.sql.counts = {
      software: await dbAll(db, "SELECT COUNT(*) AS count FROM software_logs"),
      print: await dbAll(db, "SELECT COUNT(*) AS count FROM print_logs"),
    };
    result.sql.queryPlans = {
      softwareTail: await dbAll(
        db,
        "EXPLAIN QUERY PLAN SELECT ts, level, msg FROM software_logs WHERE day = ? ORDER BY id DESC LIMIT 2001",
        [new Date().toISOString().slice(0, 10)],
      ),
      printLatest: await dbAll(
        db,
        "EXPLAIN QUERY PLAN SELECT id, timestamp, socketId, clientType, printer, templateId, pageNum, status, rePrintAble, errorMessage FROM print_logs ORDER BY timestamp DESC, id DESC LIMIT 20",
      ),
    };
    result.windows.push(
      await probeWindow({
        name: "softwareLog",
        asset: "console.html",
        hash: "#/software-log",
        preload: path.join(REPO_ROOT, "src/preload/console.js"),
        bridgeName: "hiprintSoftwareLog",
        isIpcSettled: () => result.sql.softwareRead !== undefined,
      }),
    );
    result.windows.push(
      await probeWindow({
        name: "printLog",
        asset: "console.html",
        hash: "#/print-log",
        preload: path.join(REPO_ROOT, "src/preload/console.js"),
        bridgeName: "hiprintPrintLog",
        isIpcSettled: () =>
          result.sql.printRows !== undefined && result.sql.printCount !== undefined,
      }),
    );
  } catch (error) {
    result.failed = true;
    result.error = String((error && error.stack) || error);
  }

  for (const step of result.windows) {
    if (
      !step.probe ||
      step.probe.hash !== step.hash ||
      !step.probe.hasBridge ||
      step.failedLoads.length ||
      step.consoleErrors.length
    ) {
      result.failed = true;
    }
  }

  db.close();
  clearTimeout(killTimer);
  finish(result);
});

app.on("window-all-closed", () => {});
