"use strict";

const fs = require("fs");
const path = require("path");

const electronRoot = path.resolve(__dirname, "../../..");
const sourceRoot = path.resolve(electronRoot, "..");

const paths = {
  electronUtils: path.join(electronRoot, "tools/utils.js"),
  transitIndex: path.join(sourceRoot, "node-hiprint-transit/index.js"),
  transitConfig: path.join(sourceRoot, "node-hiprint-transit/src/config.js"),
  transitRuntimeConfig: path.join(
    sourceRoot,
    "node-hiprint-transit/config.json",
  ),
  vueHiprintRouter: path.join(
    sourceRoot,
    "vue-admin-main/backend/routers/hiprint/router.py",
  ),
  vueMobilePrintRouter: path.join(
    sourceRoot,
    "vue-admin-main/backend/routers/mobile_print/__init__.py",
  ),
  vuePrintService: path.join(
    sourceRoot,
    "vue-admin-main/frontend/src/views/Tools/PrintTemplate/composables/usePrintService.ts",
  ),
  vuePluginGlobal: path.join(
    sourceRoot,
    "vue-plugin-hiprint-v2/src/hiprint/compat/hiprint-global.ts",
  ),
  vuePluginSocket: path.join(
    sourceRoot,
    "vue-plugin-hiprint-v2/src/hiprint/print/socket.ts",
  ),
  androidApiClient: path.join(
    sourceRoot,
    "UrovoShipmentScanner/app/src/main/java/com/urovo/shipment/api/ApiClient.kt",
  ),
};

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function lineOf(text, pattern) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index + 1;
  }
  return null;
}

function result(id, severity, observed, evidence) {
  return {
    id,
    severity,
    status: observed ? "RISK_REPRODUCED" : "not_observed",
    evidence,
  };
}

const electronUtils = read(paths.electronUtils);
const transitIndex = read(paths.transitIndex);
const transitConfig = read(paths.transitConfig);
const transitRuntimeConfig = read(paths.transitRuntimeConfig);
const vueHiprintRouter = read(paths.vueHiprintRouter);
const vueMobilePrintRouter = read(paths.vueMobilePrintRouter);
const vuePrintService = read(paths.vuePrintService);
const vuePluginGlobal = read(paths.vuePluginGlobal);
const vuePluginSocket = read(paths.vuePluginSocket);
const androidApiClient = read(paths.androidApiClient);

let runtimeToken = "";
try {
  runtimeToken = JSON.parse(transitRuntimeConfig).token || "";
} catch {
  // 运行时配置为非法 JSON 时保留空串默认值（下游检查对空 token 安全）。
}

const checks = [
  result(
    "TRANSIT-SEC-TOKEN-EXPOSED-TO-BROWSER",
    "high",
    /"token":\s*_decrypt_secret\(record\.token_cipher\)/.test(
      vueHiprintRouter,
    ) &&
      /getDefaultHiprintRemotePrintConfigApi/.test(vuePrintService) &&
      /hiprint\.connectTransit\([\s\S]*token/.test(vuePrintService),
    {
      files: [
        {
          file: paths.vueHiprintRouter,
          line: lineOf(vueHiprintRouter, /"token":\s*_decrypt_secret/),
        },
        {
          file: paths.vuePrintService,
          line: lineOf(vuePrintService, /hiprint\.connectTransit/),
        },
      ],
      detail:
        "Vue-admin default remote print config returns the transit token and the browser connects directly to transit.",
    },
  ),
  result(
    "TRANSIT-SEC-PLUGIN-DIRECT-CREDENTIAL-SURFACE",
    "high",
    /connectTransit\(\s*options:\s*TransitConnectOptions/.test(
      vuePluginGlobal,
    ) &&
      /ws\.setHost\(host,\s*token/.test(vuePluginGlobal) &&
      /token:\s*"vue3-print"/.test(vuePluginSocket),
    {
      files: [
        {
          file: paths.vuePluginGlobal,
          line: lineOf(vuePluginGlobal, /connectTransit\(/),
        },
        {
          file: paths.vuePluginGlobal,
          line: lineOf(vuePluginGlobal, /ws\.setHost\(host,\s*token/),
        },
        {
          file: paths.vuePluginSocket,
          line: lineOf(vuePluginSocket, /token:\s*"vue3-print"/),
        },
      ],
      detail:
        "The npm plugin exposes a public host/token direct-transit API, so production Vue-admin must not rely on it for authorization-sensitive print dispatch.",
    },
  ),
  result(
    "TRANSIT-SEC-SHARED-TOKEN-CONTROLS-PRIVILEGED-EVENTS",
    "high",
    /io\.use\([\s\S]*tokenMatches\(token,\s*socket\.handshake\.auth\?\.token\)/.test(
      transitIndex,
    ) &&
      /printEvents\.forEach\(\(event\)/.test(transitIndex) &&
      /socket\.on\(fileExportEvent/.test(transitIndex),
    {
      file: paths.transitIndex,
      lines: [
        lineOf(transitIndex, /io\.use/),
        lineOf(transitIndex, /printEvents\.forEach/),
        lineOf(transitIndex, /socket\.on\(fileExportEvent/),
      ],
      detail:
        "Any socket that knows the token can act as a web/API client and request print or file-export forwarding.",
    },
  ),
  result(
    "TRANSIT-SEC-DEFAULT-OR-WEAK-TOKEN",
    "high",
    /token:\s*'vue-plugin-hiprint'/.test(transitConfig) ||
      /^(hiprint|vue-plugin-hiprint|vue3-print)$/i.test(runtimeToken),
    {
      files: [
        {
          file: paths.transitConfig,
          line: lineOf(transitConfig, /token:\s*'vue-plugin-hiprint'/),
        },
        { file: paths.transitRuntimeConfig, tokenLength: runtimeToken.length },
      ],
      detail:
        "Transit has a default token and the checked local runtime config uses a short/default-like token.",
    },
  ),
  result(
    "TRANSIT-SEC-TOKEN-LOGGING",
    "medium",
    /token:\s*%s/.test(transitIndex) ||
      /token:\s*\$\{providedToken\}/.test(electronUtils),
    {
      files: [
        { file: paths.transitIndex, line: lineOf(transitIndex, /token:\s*%s/) },
        {
          file: paths.electronUtils,
          line: lineOf(electronUtils, /Authentication error/),
        },
      ],
      detail:
        "Transit startup output and Electron local auth failure logging can expose tokens or token guesses.",
    },
  ),
  result(
    "TRANSIT-SEC-EPHEMERAL-SOCKET-ID-AS-DEVICE-ID",
    "medium",
    /CLIENT\.get\(sToken\)\[socket\.id\]/.test(transitIndex) &&
      /socket\s*\.to\(options\.client\)/.test(transitIndex) &&
      /_find_printer_target/.test(vueMobilePrintRouter) &&
      /getMobilePrinters/.test(androidApiClient),
    {
      files: [
        {
          file: paths.transitIndex,
          line: lineOf(transitIndex, /CLIENT\.get\(sToken\)\[socket\.id\]/),
        },
        {
          file: paths.transitIndex,
          line: lineOf(transitIndex, /\.to\(options\.client\)/),
        },
        {
          file: paths.vueMobilePrintRouter,
          line: lineOf(vueMobilePrintRouter, /def _find_printer_target/),
        },
        {
          file: paths.androidApiClient,
          line: lineOf(androidApiClient, /getMobilePrinters/),
        },
      ],
      detail:
        "Vue-admin and Android operate on a transit client id that is currently the Socket.IO id, so reconnects can stale saved targets.",
    },
  ),
];

const observed = checks.filter((check) => check.status === "RISK_REPRODUCED");

console.log(
  JSON.stringify({ sourceRoot, observed: observed.length, checks }, null, 2),
);

if (observed.length > 0) {
  process.exitCode = 1;
}
