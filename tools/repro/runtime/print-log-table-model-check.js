"use strict";

// 打印记录视图纯模型契约回归。
// 验证 PrintLogView 抽出的分页、排序和 request-logs payload 构造仍保持原行为：
//   1) sort.order 三态循环为 ascending -> descending -> undefined；
//   2) 日期范围被规整为 YYYY-MM-DD HH:mm:ss；
//   3) condition/params/page/sort payload 结构不变；
//   4) 分页窗口、clamp 和 print-logs payload 归一化不变。
// 运行：node tools/repro/runtime/print-log-table-model-check.js
// 约定：stdout 打印 PRINT_LOG_TABLE_MODEL_RESULT <json>，failed=false 且退出码 0 表示通过。

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MODEL_PATH = path.join(
  REPO_ROOT,
  "src/renderer/app/windows/console/views/print-log-table-model.ts",
);

function loadModel() {
  const source = fs.readFileSync(MODEL_PATH, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: MODEL_PATH,
  }).outputText;
  const sandbox = {
    exports: {},
    module: { exports: {} },
    require,
  };
  sandbox.module.exports = sandbox.exports;
  vm.createContext(sandbox);
  new vm.Script(transpiled, { filename: MODEL_PATH }).runInContext(sandbox);
  return sandbox.module.exports;
}

function fail(result, step, details) {
  result.failed = true;
  result.steps.push({ step, details });
}

const result = { failed: false, steps: [] };

try {
  const model = loadModel();

  const asc = model.getNextPrintLogSort({}, "timestamp");
  const desc = model.getNextPrintLogSort(asc, "timestamp");
  const none = model.getNextPrintLogSort(desc, "timestamp");
  if (
    asc.prop !== "timestamp" ||
    asc.order !== "ascending" ||
    desc.prop !== "timestamp" ||
    desc.order !== "descending" ||
    none.prop !== undefined ||
    none.order !== undefined
  ) {
    fail(result, "sort-cycle", { asc, desc, none });
  }

  if (
    model.getPrintLogSortClass(asc, "timestamp") !== "asc" ||
    model.getPrintLogSortClass(desc, "timestamp") !== "desc" ||
    model.getPrintLogSortClass(desc, "status") !== ""
  ) {
    fail(result, "sort-class", {
      asc: model.getPrintLogSortClass(asc, "timestamp"),
      desc: model.getPrintLogSortClass(desc, "timestamp"),
      other: model.getPrintLogSortClass(desc, "status"),
    });
  }

  const request = model.buildPrintLogsRequest(
    {
      startTime: "2026-06-25T08:09:10",
      endTime: "2026-06-25T18:19:20",
      clientType: "transit",
      status: "failed",
    },
    3,
    50,
    desc,
  );
  const expectedCondition = [
    "timestamp >= ? AND timestamp <= ?",
    "clientType = ?",
    "status = ?",
  ];
  const expectedParams = [
    "2026-06-25 08:09:10",
    "2026-06-25 18:19:20",
    "transit",
    "failed",
  ];
  if (
    JSON.stringify(request.condition) !== JSON.stringify(expectedCondition) ||
    JSON.stringify(request.params) !== JSON.stringify(expectedParams) ||
    request.page.currentPage !== 3 ||
    request.page.pageSize !== 50 ||
    request.sort.prop !== "timestamp" ||
    request.sort.order !== "descending"
  ) {
    fail(result, "request-payload", request);
  }

  const pageItems = model.getPrintLogPageItems(12, 6);
  if (JSON.stringify(pageItems) !== JSON.stringify([1, "l-dots", 5, 6, 7, "r-dots", 12])) {
    fail(result, "page-items", { got: pageItems });
  }

  if (model.clampPrintLogPage(0, 12) !== 1 || model.clampPrintLogPage(99, 12) !== 12) {
    fail(result, "page-clamp", {
      low: model.clampPrintLogPage(0, 12),
      high: model.clampPrintLogPage(99, 12),
    });
  }

  const normalized = model.normalizePrintLogsPayload({ rows: [{ id: 1 }], total: "7" });
  if (normalized.rows.length !== 1 || normalized.total !== 7) {
    fail(result, "payload-normalize", normalized);
  }
} catch (err) {
  fail(result, "exception", String((err && err.stack) || err));
}

console.log("PRINT_LOG_TABLE_MODEL_RESULT " + JSON.stringify(result));
process.exit(result.failed ? 1 : 0);
