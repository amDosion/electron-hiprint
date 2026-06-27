"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const utilsJs = fs.readFileSync(path.join(repoRoot, "tools/utils.js"), "utf8");

function count(pattern) {
  return (utilsJs.match(pattern) || []).length;
}

function expect(name, ok, details) {
  return { name, ok: Boolean(ok), details };
}

const checks = [
  expect(
    "ipp-handlers-are-shared",
    /function bindIppHandlers\(socket, \{ label, includeReplyId \}\)/.test(
      utilsJs,
    ) &&
      count(/\.on\("ippPrint"/g) === 1 &&
      count(/\.on\("ippRequest"/g) === 1,
  ),
  expect(
    "local-and-transit-ipp-bindings-preserve-replyid-contract",
    /bindIppHandlers\(socket, \{ label: "插件端", includeReplyId: false \}\)/.test(
      utilsJs,
    ) &&
      /bindIppHandlers\(client, \{ label: "中转服务", includeReplyId: true \}\)/.test(
        utilsJs,
      ) &&
      /includeReplyId\s*\?\s*\{ replyId \}\s*:\s*null/.test(utilsJs),
  ),
  expect(
    "print-task-handler-is-shared",
    /function bindPrintTaskHandler\(socket, clientType\)/.test(utilsJs) &&
      /bindPrintTaskHandler\(socket, "local"\)/.test(utilsJs) &&
      /bindPrintTaskHandler\(client, "transit"\)/.test(utilsJs) &&
      /enqueuePrintTask\(data, socket\.id, "local"\)/.test(utilsJs),
  ),
  expect(
    "render-task-handlers-are-shared",
    /function bindRenderTaskHandlers\(socket, clientType\)/.test(utilsJs) &&
      count(/\.on\("render-print"/g) === 1 &&
      count(/\.on\("render-jpeg"/g) === 1 &&
      count(/\.on\("render-pdf"/g) === 1 &&
      /bindRenderTaskHandlers\(socket, "local"\)/.test(utilsJs) &&
      /bindRenderTaskHandlers\(client, "transit"\)/.test(utilsJs),
  ),
  expect(
    "file-export-and-print-status-handlers-are-shared",
    /function bindFileExportHandler\(socket, label\)/.test(utilsJs) &&
      /function bindPrintStatusHandler\(socket, label\)/.test(utilsJs) &&
      count(/\.on\("file\.export"/g) === 1 &&
      count(/\.on\("getPrintStatus"/g) === 1 &&
      /bindFileExportHandler\(socket, "插件端"\)/.test(utilsJs) &&
      /bindFileExportHandler\(client, "中转服务"\)/.test(utilsJs) &&
      /bindPrintStatusHandler\(socket, "插件端"\)/.test(utilsJs) &&
      /bindPrintStatusHandler\(client, "中转服务"\)/.test(utilsJs),
  ),
];

const failures = checks.filter((check) => !check.ok);
console.log(
  JSON.stringify(
    {
      observed: failures.length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  process.exitCode = 1;
}
