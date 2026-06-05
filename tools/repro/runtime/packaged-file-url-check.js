"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const files = ["main.js", "src/set.js", "src/print.js", "src/render.js", "src/printLog.js"];
const risks = [];

for (const relativePath of files) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
  if (/path\.join\(\s*["']file:\/\//.test(content)) {
    risks.push({
      id: "RUNTIME-WINDOWS-FILE-URL-PATH-JOIN",
      severity: "critical",
      file: relativePath,
      detail:
        'path.join("file://", ...) creates invalid Windows URLs such as .\\file:\\C:\\..., leaving packaged windows blank.',
      });
  }
  if (/preload:\s*path\.join\(__dirname/.test(content) && !/sandbox:\s*false/.test(content)) {
    risks.push({
      id: "RUNTIME-PRELOAD-SANDBOX-BLOCKS-COMMONJS",
      severity: "critical",
      file: relativePath,
      detail:
        "Electron 42 sandboxed preloads cannot run the existing CommonJS preload modules that require electron-store or package metadata.",
    });
  }
}

const helperPath = path.join(repoRoot, "src/asset-url.js");
if (!fs.existsSync(helperPath)) {
  risks.push({
    id: "RUNTIME-ASSET-URL-HELPER-MISSING",
    severity: "high",
    detail: "Window asset loading should use a shared pathToFileURL helper.",
  });
} else {
  const helper = fs.readFileSync(helperPath, "utf8");
  if (!/pathToFileURL/.test(helper)) {
    risks.push({
      id: "RUNTIME-ASSET-URL-HELPER-NOT-USING-PATH-TO-FILE-URL",
      severity: "high",
      detail: "The shared helper must use node:url pathToFileURL for Windows-safe file URLs.",
    });
  }
}

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
