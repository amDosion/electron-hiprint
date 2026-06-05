"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const mainPath = path.join(repoRoot, "main.js");
const mainJs = fs.readFileSync(mainPath, "utf8");
const risks = [];

const lockBlock = mainJs.match(/if\s*\(\s*!gotTheLock\s*\)\s*\{([\s\S]*?)\n\s*\}/);
if (!lockBlock) {
  risks.push({
    id: "MAIN-SINGLE-INSTANCE-LOCK-GUARD-MISSING",
    severity: "high",
    detail: "initialize() should guard the no-lock path from continuing startup.",
  });
} else if (!/\breturn\b/.test(lockBlock[1])) {
  risks.push({
    id: "MAIN-SINGLE-INSTANCE-CONTINUES-AFTER-QUIT",
    severity: "high",
    detail:
      "When requestSingleInstanceLock() fails, initialize() calls appQuit() but continues registering handlers and starting services.",
  });
}

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
