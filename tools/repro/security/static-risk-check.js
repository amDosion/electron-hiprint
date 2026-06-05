"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const MB = 1024 * 1024;

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function firstLine(text, pattern) {
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (matcher.test(lines[index])) return index + 1;
  }
  return null;
}

function countMatches(text, pattern) {
  return (text.match(pattern) || []).length;
}

function result(id, severity, observed, evidence) {
  return {
    id,
    severity,
    status: observed ? "RISK_REPRODUCED" : "not_observed",
    evidence,
  };
}

const packageJsonText = readText("package.json");
const packageJson = JSON.parse(packageJsonText);
const mainJs = readText("main.js");
const utilsJs = readText("tools/utils.js");
const setJs = readText("src/set.js");
const printHtml = readText("assets/print.html");
const renderHtml = readText("assets/render.html");
const gitignore = readText(".gitignore");

const electronSpec =
  packageJson.devDependencies && packageJson.devDependencies.electron;
const electronMajor = Number(String(electronSpec || "").match(/\d+/)?.[0]);
function resolveNumericMainJsValue(rawValue) {
  if (/^\d+$/.test(rawValue)) return Number(rawValue);
  const constantMatch = mainJs.match(
    new RegExp(`const\\s+${rawValue}\\s*=\\s*(\\d+)`),
  );
  return constantMatch ? Number(constantMatch[1]) : null;
}

const maxHttpBufferMatch = mainJs.match(/maxHttpBufferSize:\s*([A-Z0-9_]+|\d+)/);
const maxHttpBufferSize = maxHttpBufferMatch
  ? resolveNumericMainJsValue(maxHttpBufferMatch[1])
  : null;

const checks = [
  result(
    "SEC-AUTH-DEFAULT-EMPTY",
    "critical",
    /token:\s*{[\s\S]*?default:\s*""/.test(utilsJs) &&
      /if\s*\(\s*token\s*&&\s*token\s*!==/.test(utilsJs),
    {
      file: "tools/utils.js",
      lines: [
        firstLine(utilsJs, /token:\s*{/),
        firstLine(utilsJs, /if\s*\(\s*token\s*&&\s*token\s*!==/),
      ],
      detail: "Default empty token combines with conditional auth that only checks when token is truthy.",
    },
  ),
  result(
    "SEC-SOCKET-BINDS-ALL-INTERFACES",
    "critical",
    /server\.listen\(\s*store\.get\("port"\)\s*\|\|\s*17521\s*\)/.test(mainJs),
    {
      file: "main.js",
      line: firstLine(mainJs, /server\.listen/),
      detail: "server.listen is called without an explicit host argument.",
    },
  ),
  result(
    "SEC-CORS-REFLECTS-ORIGIN",
    "critical",
    /callback\(\s*null\s*,\s*requestOrigin\s*\)/.test(mainJs),
    {
      file: "main.js",
      line: firstLine(mainJs, /callback\(\s*null\s*,\s*requestOrigin\s*\)/),
      detail: "Socket.IO CORS origin callback reflects the request origin.",
    },
  ),
  result(
    "SEC-NODE-ENABLED-RENDERERS",
    "critical",
    countMatches(
      [mainJs, setJs, readText("src/print.js"), readText("src/render.js"), readText("src/printLog.js")].join("\n"),
      /nodeIntegration:\s*true/g,
    ) > 0 &&
      countMatches(
        [mainJs, setJs, readText("src/print.js"), readText("src/render.js"), readText("src/printLog.js")].join("\n"),
        /contextIsolation:\s*false/g,
      ) > 0,
    {
      files: ["main.js", "src/set.js", "src/print.js", "src/render.js", "src/printLog.js"],
      detail: "Renderer windows enable Node and disable context isolation.",
    },
  ),
  result(
    "SEC-REMOTE-HTML-INNERHTML",
    "critical",
    /innerHTML\s*=\s*data\.html/.test(printHtml) ||
      /\.html\(\s*html\s*\)/.test(renderHtml),
    {
      files: [
        {
          file: "assets/print.html",
          line: firstLine(printHtml, /innerHTML\s*=\s*data\.html/),
        },
        {
          file: "assets/render.html",
          line: firstLine(renderHtml, /\.html\(\s*html\s*\)/),
        },
      ],
      detail: "Remote-provided HTML is injected into Node-enabled renderers.",
    },
  ),
  result(
    "OPS-SOCKET-BUFFER-10GB",
    "high",
    Number.isFinite(maxHttpBufferSize) && maxHttpBufferSize > 100 * MB,
    {
      file: "main.js",
      line: firstLine(mainJs, /maxHttpBufferSize/),
      value: maxHttpBufferSize,
      detail: "Socket.IO maxHttpBufferSize is larger than 100 MB.",
    },
  ),
  result(
    "SEC-PLUGIN-DOWNLOAD-NO-INTEGRITY",
    "high",
    /https\.get\(/.test(setJs) &&
      !/sha256|integrity|signature/i.test(setJs) &&
      !/fileStream\.on\(\s*"finish"/.test(setJs),
    {
      file: "src/set.js",
      line: firstLine(setJs, /https\.get\(/),
      detail: "Plugin download has no integrity check and does not wait for fileStream finish.",
    },
  ),
  result(
    "SUPPLY-NO-LOCKFILE",
    "high",
    !["package-lock.json", "yarn.lock", "pnpm-lock.yaml"].some((file) =>
      fs.existsSync(path.join(repoRoot, file)),
    ) && /^package-lock\.json$/m.test(gitignore),
    {
      file: ".gitignore",
      line: firstLine(gitignore, /^package-lock\.json$/),
      detail: "No dependency lockfile exists and package-lock.json is ignored.",
    },
  ),
  result(
    "SUPPLY-ELECTRON-17-EOL",
    "high",
    Number.isFinite(electronMajor) && electronMajor <= 17,
    {
      file: "package.json",
      line: firstLine(packageJsonText, /"electron"\s*:/),
      value: electronSpec,
      detail: "Electron major version is 17 or older.",
    },
  ),
];

const observed = checks.filter((check) => check.status === "RISK_REPRODUCED");

console.log(JSON.stringify({ repoRoot, observed: observed.length, checks }, null, 2));

if (observed.length > 0) {
  process.exitCode = 1;
}
