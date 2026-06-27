"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

function count(text, pattern) {
  return (text.match(pattern) || []).length;
}

const printJs = read("src/print.js");
const renderJs = read("src/render.js");
const writerJs = read("src/print-log-writer.js");

const checks = [
  {
    name: "writer-owns-print-log-insert",
    ok:
      count([printJs, renderJs].join("\n"), /INSERT INTO print_logs/g) === 0 &&
      count(writerJs, /INSERT INTO print_logs/g) === 1,
  },
  {
    name: "print-path-omits-pdf-blob",
    ok:
      /writePrintLog\(\{[\s\S]*omitPdfBlob:\s*true[\s\S]*\}\);/.test(
        printJs,
      ) && /pdf_blob"\)[\s\S]*"\[omitted\]"/.test(writerJs),
  },
  {
    name: "render-path-uses-shared-writer",
    ok:
      /const \{ writePrintLog \} = require\("\.\/print-log-writer"\)/.test(
        renderJs,
      ) && /writePrintLog\(\{[\s\S]*clientType:\s*data\.clientType/.test(renderJs),
  },
  {
    name: "writer-preserves-reprint-default-and-error-log",
    ok:
      /rePrintAble \?\? 1/.test(writerJs) &&
      /console\.error\("Failed to log print result", err\)/.test(writerJs),
  },
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
