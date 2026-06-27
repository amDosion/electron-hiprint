"use strict";

/**
 * 回归诊断（静态源码断言）：2026-06-10 安全加固批次。
 *
 * 这些修复涉及 Electron 运行时依赖，无法在纯 node 下单测；本脚本通过读取源码、
 * 断言关键守卫仍在位，防止后续改动把保护意外回退。每条断言对应一个已修复的高危项。
 *
 * 约定：observed=0 表示全部守卫在位；缺失任一守卫记为风险，exit 1。
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../../..");
const risks = [];
const passed = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function check(id, file, predicate, detail) {
  let ok = false;
  try {
    ok = predicate(read(file));
  } catch (error) {
    risks.push({ id, file, detail: `读取/断言失败：${error.message}` });
    return;
  }
  if (ok) {
    passed.push({ id, file });
  } else {
    risks.push({ id, file, detail });
  }
}

// C-1：hiprint:store-get 必须有 key 白名单，且不再无条件 store.get(key)
check(
  "SEC-C1-STORE-GET-ALLOWLIST",
  "src/console-ipc.js",
  (src) =>
    src.includes("STORE_GET_ALLOWED_KEYS") &&
    /STORE_GET_ALLOWED_KEYS\.has\(\s*key\s*\)/.test(src),
  "src/console-ipc.js 的 hiprint:store-get 缺少 key 白名单，可能泄露 token/transitToken",
);

// C-2：打印记录查询必须经 buildSafeLogQuery 守卫，不得再直接 join condition
check(
  "SEC-C2-LOGQUERY-GUARD",
  "src/console-ipc.js",
  (src) =>
    src.includes("buildSafeLogQuery") &&
    !src.includes('" WHERE " + condition.join'),
  "src/console-ipc.js 未使用 buildSafeLogQuery 守卫，存在 SQL 注入风险",
);

// C-3：url_pdf 下载前必须做 SSRF 校验 + DNS 重绑定校验
check(
  "SEC-C3-URLPDF-SSRF",
  "src/pdf-print.js",
  (src) =>
    src.includes("getHttpUrlTargetError") &&
    src.includes("dns.lookup") &&
    /isBlockedIPv4|isBlockedIPv6/.test(src),
  "src/pdf-print.js 的 url_pdf 路径缺少 SSRF / DNS 重绑定校验",
);

// C-4：unixPrintOptions 必须净化后再传给 lp
check(
  "SEC-C4-UNIX-LP-SANITIZE",
  "src/pdf-print.js",
  (src) =>
    src.includes("sanitizeUnixPrintOptions") &&
    !/printPdfFunction\(pdfPath,\s*printer,\s*data\.unixPrintOptions/.test(src),
  "src/pdf-print.js 直接把 unixPrintOptions 传给 lp，存在命令注入风险",
);

// H-1：认证失败日志不得包含对端提交的 token
check(
  "SEC-H1-NO-TOKEN-LOG",
  "tools/utils.js",
  (src) => !/Authentication error[^\n]*\$\{providedToken\}/.test(src),
  "tools/utils.js 认证失败日志仍打印 providedToken",
);

// H-2：openDirectory 必须校验是目录后才 openPath
check(
  "SEC-H2-OPENDIR-ISDIR",
  "src/console-ipc.js",
  (src) =>
    /isDirectory\(\)/.test(src) &&
    /openDirectory[\s\S]{0,200}statSync/.test(src),
  "src/console-ipc.js openDirectory 未校验目录，可能执行任意文件",
);

const observed = risks.length;
console.log(
  JSON.stringify(
    {
      batch: "security-hardening-2026-06-10",
      observed,
      passed: passed.length,
      risks,
    },
    null,
    2,
  ),
);
process.exitCode = observed > 0 ? 1 : 0;
