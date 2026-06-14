"use strict";

/**
 * 打印日志查询守卫（纯函数，无 Electron 依赖，便于单测）。
 *
 * 背景：渲染端（printLog.html）通过 IPC 把 `condition` SQL 片段数组直接发到主进程，
 * 旧实现 `" WHERE " + condition.join(" AND ")` 把片段原样拼进 SQL，存在注入风险
 * （恶意/被篡改渲染端可发 `1=1; DROP TABLE ...`）。LIMIT/OFFSET 也由 page 直接插值。
 *
 * 本守卫只接受白名单内的参数化片段，并把分页强制为正整数后再交给上层拼接，
 * 既保留既有合法查询行为，又杜绝任意 SQL 片段/列名注入。
 */

// 允许等值过滤的列（与 print_logs 表列对齐）。列名只能来自此集合，值仍走 ? 占位。
const EQUALITY_COLUMNS = new Set([
  "socketId",
  "clientType",
  "printer",
  "templateId",
  "pageNum",
  "status",
  "rePrintAble",
]);

// 时间范围是渲染端拼成的单一组合片段，单独白名单放行。
const TIMESTAMP_RANGE = "timestamp >= ? AND timestamp <= ?";

// 允许排序的列白名单（沿用旧实现的列集合）。
const SORTABLE_COLUMNS = new Set([
  "id",
  "timestamp",
  "socketId",
  "clientType",
  "printer",
  "templateId",
  "pageNum",
  "status",
  "rePrintAble",
  "errorMessage",
]);

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 200;
const DEFAULT_ORDER_BY = " ORDER BY timestamp DESC, id DESC";

function countPlaceholders(fragment) {
  return (fragment.match(/\?/g) || []).length;
}

function isAllowedFragment(fragment) {
  if (fragment === TIMESTAMP_RANGE) return true;
  const matched = /^([A-Za-z]+) = \?$/.exec(fragment);
  return Boolean(matched && EQUALITY_COLUMNS.has(matched[1]));
}

function toPositiveInt(value, fallback, max) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return typeof max === "number" ? Math.min(parsed, max) : parsed;
}

/**
 * @param {{condition?: any, params?: any, page?: any, sort?: any}} payload 渲染端 IPC 负载
 * @returns {{whereClause: string, params: any[], orderBy: string, limit: number, offset: number}}
 * @throws {Error} 当条件片段不在白名单内，或参数数量与占位符不匹配时抛出
 */
function buildSafeLogQuery(payload = {}) {
  const { condition, params, page, sort } = payload;
  const fragments = Array.isArray(condition) ? condition : [];
  const safeParams = Array.isArray(params) ? params : [];

  let expectedParams = 0;
  for (const fragment of fragments) {
    if (typeof fragment !== "string" || !isAllowedFragment(fragment)) {
      throw new Error(`非法查询条件: ${String(fragment)}`);
    }
    expectedParams += countPlaceholders(fragment);
  }
  if (expectedParams !== safeParams.length) {
    throw new Error("查询参数数量与条件占位符不匹配");
  }

  const whereClause = fragments.length
    ? ` WHERE ${fragments.join(" AND ")}`
    : "";

  let orderBy = DEFAULT_ORDER_BY;
  if (sort && sort.prop && sort.order && SORTABLE_COLUMNS.has(sort.prop)) {
    const direction =
      String(sort.order)
        .replace("ending", "")
        .toUpperCase() === "ASC"
        ? "ASC"
        : "DESC";
    orderBy =
      sort.prop === "timestamp"
        ? ` ORDER BY timestamp ${direction}, id ${direction}`
        : ` ORDER BY ${sort.prop} ${direction}`;
  }

  const limit = toPositiveInt(
    page && page.pageSize,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
  );
  const currentPage = toPositiveInt(page && page.currentPage, 1);
  const offset = (currentPage - 1) * limit;

  return { whereClause, params: safeParams, orderBy, limit, offset };
}

module.exports = {
  buildSafeLogQuery,
  EQUALITY_COLUMNS,
  SORTABLE_COLUMNS,
  TIMESTAMP_RANGE,
  MAX_PAGE_SIZE,
  DEFAULT_ORDER_BY,
};
