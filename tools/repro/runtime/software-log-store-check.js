"use strict";

// 软件日志 sqlite 存储读写回归（需真实 Electron）。
// 验证 src/software-log-store.js：appendFromTransport 写入 → listDates/readLog 读回，
// 覆盖多参数格式化、Error 序列化、级别归一、末尾升序展示、非法日期拒绝。
// 隔离：伪造 isPackaged + 临时 userData，使 tools/database.js 走打包态分支用临时 DB，
//       不污染开发库 tools/database.sqlite。
// 运行：npx electron tools/repro/runtime/software-log-store-check.js
// 约定：stdout 打印 STORE_RESULT <json>，failed=false 且退出码 0 表示通过。

const path = require("path");
const os = require("os");
const fs = require("fs");
const electron = require("electron");
const { app } = electron;
const dayjs = require("dayjs");
const sqlite3 = require("sqlite3").verbose();

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hiprint-swlog-"));
Object.defineProperty(app, "isPackaged", { value: true, configurable: true });
app.setPath("userData", tmpDir);

function cleanupAndExit(result) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 清理失败忽略 */
  }
  app.exit(result.failed ? 1 : 0);
}

function finish(result) {
  result.failed = Boolean(result.failed);
  console.log("STORE_RESULT " + JSON.stringify(result));
  try {
    const databaseModulePath = path.join(__dirname, "../../../tools/database");
    const cached = require.cache[require.resolve(databaseModulePath)];
    const db = cached && cached.exports;
    if (db && typeof db.close === "function") {
      db.close(() => cleanupAndExit(result));
      return;
    }
  } catch {
    /* 关闭失败继续退出 */
  }
  cleanupAndExit(result);
}

const killTimer = setTimeout(
  () => finish({ failed: true, steps: [{ step: "timeout" }] }),
  15000,
);
killTimer.unref && killTimer.unref();

app.whenReady().then(async () => {
  const result = { steps: [] };
  try {
    const store = require(path.join(
      __dirname,
      "../../../src/software-log-store",
    ));

    const now = new Date();
    // 写入 3 条：含非字符串参数（对象）与 Error，验证多参数格式化与级别处理
    store.appendFromTransport({
      level: "info",
      date: now,
      data: ["服务已启动", { port: 17521 }],
    });
    store.appendFromTransport({ level: "warn", date: now, data: ["端口占用"] });
    store.appendFromTransport({
      level: "error",
      date: now,
      data: [new Error("连接失败")],
    });

    // sqlite 异步写入，等待落库
    await new Promise((r) => setTimeout(r, 600));

    const today = dayjs(now).format("YYYY-MM-DD");
    const dates = await store.listDates();
    const log = await store.readLog(today);
    const bad = await store.readLog("not-a-date");
    const indexRows = await new Promise((resolve) => {
      const db = new sqlite3.Database(store.getDatabasePath());
      db.all(
        "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
        [],
        (_err, rows) => {
          db.close(() => resolve(Array.isArray(rows) ? rows : []));
        },
      );
    });
    const indexes = indexRows.map((row) => row.name);

    result.dates = dates;
    result.lineCount = log.lines.length;
    result.levels = log.lines.map((l) => l.level);
    result.firstMsg = log.lines[0] ? log.lines[0].msg : null;
    result.indexes = indexes;

    if (!dates.includes(today)) {
      result.failed = true;
      result.steps.push({ step: "date-missing", got: dates });
    }
    if (log.lines.length !== 3) {
      result.failed = true;
      result.steps.push({ step: "line-count", got: log.lines.length });
    }
    // 末尾升序展示：第一条应是最早写入的 info「服务已启动 {...}」（含对象被 JSON 序列化）
    if (
      log.lines[0] &&
      !(
        log.lines[0].level === "info" &&
        /服务已启动/.test(log.lines[0].msg) &&
        /17521/.test(log.lines[0].msg)
      )
    ) {
      result.failed = true;
      result.steps.push({ step: "order-or-format", got: log.lines[0] });
    }
    // Error 应被格式化为含「连接失败」的字符串，级别 error
    if (!log.lines.some((l) => l.level === "error" && /连接失败/.test(l.msg))) {
      result.failed = true;
      result.steps.push({ step: "error-format-missing", got: log.lines });
    }
    // 非法日期返回空，不抛
    if (bad.lines.length !== 0) {
      result.failed = true;
      result.steps.push({ step: "bad-date-not-empty", got: bad });
    }
    for (const name of [
      "idx_software_logs_day_id",
      "idx_print_logs_timestamp_id",
      "idx_print_logs_template_timestamp_id",
    ]) {
      if (!indexes.includes(name)) {
        result.failed = true;
        result.steps.push({ step: "index-missing", name, got: indexes });
      }
    }

    // clearAll：清空后日期列表为空、当日读取 0 行（软件日志窗口「清空」功能的删除路径回归）
    const cleared = await store.clearAll();
    const datesAfter = await store.listDates();
    const logAfter = await store.readLog(today);
    result.clearReturn = cleared;
    result.datesAfter = datesAfter;
    result.lineCountAfter = logAfter.lines.length;
    if (cleared !== true) {
      result.failed = true;
      result.steps.push({ step: "clear-return-not-true", got: cleared });
    }
    if (datesAfter.length !== 0) {
      result.failed = true;
      result.steps.push({
        step: "dates-not-empty-after-clear",
        got: datesAfter,
      });
    }
    if (logAfter.lines.length !== 0) {
      result.failed = true;
      result.steps.push({
        step: "lines-not-empty-after-clear",
        got: logAfter.lines.length,
      });
    }
  } catch (err) {
    result.failed = true;
    result.error = String((err && err.stack) || err);
  }
  clearTimeout(killTimer);
  finish(result);
});

app.on("window-all-closed", () => {});
