"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const utilsPath = path.join(repoRoot, "tools/utils.js");
const utilsJs = fs.readFileSync(utilsPath, "utf8");

const risks = [];
const exportsBlock = utilsJs.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);

function hasExport(name) {
  return Boolean(
    exportsBlock &&
      new RegExp(`(^|\\n)\\s*${name}\\s*,`, "m").test(exportsBlock[1]),
  );
}

function expect(condition, id, detail) {
  if (!condition) {
    risks.push({ id, detail });
  }
}

expect(
  /function getExportCapability\(\)/.test(utilsJs) &&
    /fileExport:\s*getExportCapability\(\)/.test(utilsJs),
  "EXPORT-CAPABILITY-OWNER-MISSING",
  "tools/utils.js should keep getExportCapability as the single source for the client file-export capability summary.",
);

expect(
  hasExport("getExportCapability"),
  "EXPORT-CAPABILITY-NOT-EXPORTED",
  "getExportCapability returns a path-free capability summary and should be reusable by future main-process modules.",
);

expect(
  !hasExport("normalizeExportDirectoryConfig"),
  "EXPORT-DIRECTORY-RAW-CONFIG-EXPORTED",
  "normalizeExportDirectoryConfig includes the real local path and should stay private until a caller has a verified need for that trusted value.",
);

expect(
  !hasExport("generateWatchTask"),
  "WATCH-TASK-FACTORY-EXPORTED",
  "generateWatchTask is an implementation detail of print-fragment cleanup and should not be widened as public utils API.",
);

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
