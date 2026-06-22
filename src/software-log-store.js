"use strict";

// 软件日志的 sqlite 存储层：被 main.js（electron-log transport 写入）与
// src/softwareLog.js（窗口读取/打开数据库目录）共用，使软件日志与打印日志统一落到 sqlite。
//
// 关键约束：写入路径运行在「console 已被 electron-log 接管」的环境下
//（main.js: Object.assign(console, electronLog.functions)），因此写入侧的
// 任何错误处理都 **禁止调用 console**，否则会触发 transport 递归。读取侧
// 不在该热路径上，可正常容错。

const db = require("../tools/database");
const dayjs = require("dayjs");

// 单日读取上限，避免一次性读入超大日志。
const MAX_LINES = 2000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const KNOWN_LEVELS = new Set([
  "error",
  "warn",
  "info",
  "verbose",
  "debug",
  "silly",
]);

const schemaReady =
  typeof db.whenReady === "function" ? db.whenReady() : Promise.resolve();
let reportedWriteError = false;

function reportWriteError(error) {
  if (!error || reportedWriteError) return;
  reportedWriteError = true;
  try {
    process.stderr.write(
      `software-log sqlite write failed: ${error.message || error}\n`,
    );
  } catch {
    // stderr 失败时不能再走 console，否则会递归进入 electron-log transport。
  }
}

/**
 * 将单个日志参数格式化为可读字符串（对齐 console.log(a, b, c) 的多参数语义）。
 * @param {unknown} part
 * @return {string}
 */
function formatPart(part) {
  if (typeof part === "string") return part;
  if (part instanceof Error) return part.stack || part.message || String(part);
  if (part === undefined) return "undefined";
  if (part === null) return "null";
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

/**
 * electron-log v5 自定义 transport：把一条日志写入 software_logs 表。
 * 容错且静默，绝不抛出、绝不调用 console（防止与被接管的 console 递归）。
 * @param {{data?: unknown[], level?: string, date?: Date}} message
 * @return {void}
 */
function appendFromTransport(message) {
  try {
    const parts = Array.isArray(message && message.data)
      ? message.data
      : [message && message.data];
    const text = parts.map(formatPart).join(" ");
    const rawLevel = String((message && message.level) || "info").toLowerCase();
    const level = KNOWN_LEVELS.has(rawLevel) ? rawLevel : "info";
    const when =
      message && message.date instanceof Date ? message.date : new Date();
    const day = dayjs(when).format("YYYY-MM-DD");
    const ts = dayjs(when).format("YYYY-MM-DD HH:mm:ss.SSS");

    schemaReady.then(
      () => {
        db.run(
          "INSERT INTO software_logs (day, ts, level, msg) VALUES (?, ?, ?, ?)",
          [day, ts, level, text],
          reportWriteError,
        );
      },
      reportWriteError,
    );
  } catch (error) {
    reportWriteError(error);
  }
}

/**
 * @return {string} 当前 sqlite 数据库路径
 */
function getDatabasePath() {
  return db.getDatabasePath();
}

/**
 * 列出有日志的日期（降序），对齐原文本实现的「按天选择」UI。
 * @return {Promise<string[]>}
 */
function listDates() {
  return new Promise((resolve) => {
    db.all(
      "SELECT DISTINCT day FROM software_logs WHERE day IS NOT NULL ORDER BY day DESC",
      [],
      (err, rows) => {
        if (err || !Array.isArray(rows)) return resolve([]);
        resolve(rows.map((r) => r.day).filter(Boolean));
      },
    );
  });
}

/**
 * 读取某一天的日志（取末尾 MAX_LINES 行，与原文本实现语义一致）。
 * @param {string} date 形如 YYYY-MM-DD
 * @return {Promise<{lines: Array<{ts: string, level: string, msg: string}>, file: string|null, truncated: boolean}>}
 */
function readLog(date) {
  const empty = { lines: [], file: null, truncated: false };
  return new Promise((resolve) => {
    if (typeof date !== "string" || !DATE_RE.test(date)) {
      return resolve(empty);
    }
    // 多取 1 行用于判断是否被截断；按 id 降序取末尾，再反转为时间升序展示。
    db.all(
      "SELECT ts, level, msg FROM software_logs WHERE day = ? ORDER BY id DESC LIMIT ?",
      [date, MAX_LINES + 1],
      (err, rows) => {
        if (err || !Array.isArray(rows)) return resolve(empty);
        const truncated = rows.length > MAX_LINES;
        const slice = truncated ? rows.slice(0, MAX_LINES) : rows;
        const lines = slice.reverse().map((r) => ({
          ts: r.ts || "",
          level: KNOWN_LEVELS.has(String(r.level)) ? r.level : "info",
          msg: r.msg != null ? r.msg : "",
        }));
        resolve({ lines, file: date, truncated });
      },
    );
  });
}

/**
 * 清空全部软件日志（DELETE FROM software_logs）。
 * 固定语句、无用户输入，与「打印记录·清空」一致；失败时静默并以 false 反馈。
 * @return {Promise<boolean>} 是否成功
 */
function clearAll() {
  return new Promise((resolve) => {
    db.run("DELETE FROM software_logs", [], (err) => {
      resolve(!err);
    });
  });
}

module.exports = {
  appendFromTransport,
  listDates,
  readLog,
  getDatabasePath,
  clearAll,
};
