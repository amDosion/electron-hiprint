"use strict";

/**
 * 回归诊断：打印日志查询 SQL 注入守卫（src/log-query-guard.js）。
 *
 * 复现的历史风险：旧实现 `" WHERE " + condition.join(" AND ")` 把渲染端 IPC
 * 传来的 SQL 片段原样拼进查询；恶意/被篡改渲染端可注入任意 SQL，LIMIT/OFFSET
 * 也由 page 直接插值。
 *
 * 本脚本对 buildSafeLogQuery 做纯函数级断言：
 *   - 合法查询正常通过且参数化；
 *   - 注入片段 / 非白名单列 / 参数数量不匹配 一律抛出（被拒绝）；
 *   - 非整数分页被强制为安全整数，不进入 SQL 文本。
 *
 * 约定：observed=0 表示所有注入向量均被守卫拦截；非 0 表示存在未拦截风险，exit 1。
 */

const path = require("path");
const { buildSafeLogQuery } = require(path.join(
  __dirname,
  "../../../src/log-query-guard",
));

const risks = [];
const passed = [];

function expectAccept(name, payload, verify) {
  try {
    const result = buildSafeLogQuery(payload);
    if (verify) verify(result);
    passed.push({ name, kind: "accept", result });
  } catch (error) {
    risks.push({
      id: "SEC-LOGQUERY-FALSE-REJECT",
      name,
      detail: `合法查询被误拒：${error.message}`,
    });
  }
}

function expectReject(name, payload) {
  try {
    const result = buildSafeLogQuery(payload);
    risks.push({
      id: "SEC-LOGQUERY-INJECTION",
      name,
      detail: `注入向量未被拦截，生成了查询：${JSON.stringify(result)}`,
    });
  } catch (error) {
    passed.push({ name, kind: "reject", reason: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---- 合法查询应通过 ----
expectAccept(
  "时间范围 + 类型 + 状态过滤",
  {
    condition: [
      "timestamp >= ? AND timestamp <= ?",
      "clientType = ?",
      "status = ?",
    ],
    params: ["2026-06-01 00:00:00", "2026-06-10 23:59:59", "local", "success"],
    page: { currentPage: 2, pageSize: 50 },
    sort: { prop: "timestamp", order: "descending" },
  },
  (r) => {
    assert(
      r.whereClause ===
        " WHERE timestamp >= ? AND timestamp <= ? AND clientType = ? AND status = ?",
      "whereClause 不符合预期",
    );
    assert(r.params.length === 4, "params 数量不符");
    assert(r.orderBy === " ORDER BY timestamp DESC", "orderBy 不符合预期");
    assert(r.limit === 50 && r.offset === 50, "分页计算错误");
  },
);

expectAccept(
  "空条件（全量）",
  { condition: [], params: [], page: {}, sort: {} },
  (r) => {
    assert(r.whereClause === "", "空条件不应产生 WHERE");
    assert(r.limit === 20 && r.offset === 0, "默认分页错误");
  },
);

// ---- 注入向量应被拒绝 ----
expectReject("拼接 DROP TABLE", {
  condition: ["1=1; DROP TABLE print_logs; --"],
  params: [],
  page: { currentPage: 1, pageSize: 20 },
});

expectReject("UNION SELECT 注入", {
  condition: ["status = ? UNION SELECT token FROM sqlite_master"],
  params: ["success"],
  page: { currentPage: 1, pageSize: 20 },
});

expectReject("非白名单列名", {
  condition: ["evilColumn = ?"],
  params: ["x"],
  page: { currentPage: 1, pageSize: 20 },
});

expectReject("参数数量与占位符不匹配", {
  condition: ["status = ?"],
  params: ["a", "b"],
  page: { currentPage: 1, pageSize: 20 },
});

// ---- 分页注入应被强制为安全整数（不抛错，但不得把恶意串带入 SQL）----
expectAccept(
  "恶意 pageSize 被强制为整数",
  {
    condition: [],
    params: [],
    page: {
      currentPage: "1; DROP TABLE print_logs",
      pageSize: "20; DROP TABLE print_logs",
    },
    sort: {},
  },
  (r) => {
    assert(Number.isInteger(r.limit), "limit 必须为整数");
    assert(Number.isInteger(r.offset), "offset 必须为整数");
    assert(
      !String(r.limit).includes("DROP") && !String(r.offset).includes("DROP"),
      "分页字段混入了 SQL 文本",
    );
  },
);

const observed = risks.length;
console.log(
  JSON.stringify(
    {
      module: "src/log-query-guard.js",
      observed,
      passed: passed.length,
      risks,
    },
    null,
    2,
  ),
);
process.exitCode = observed > 0 ? 1 : 0;
