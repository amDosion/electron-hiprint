"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function record(risks, id, ok, detail) {
  if (!ok) {
    risks.push({ id, detail });
  }
}

function main() {
  const risks = [];
  const setMain = read("src/set.js");
  const setHtml = read("assets/set.html");
  const indexHtml = read("assets/index.html");
  const renderHtml = read("assets/render.html");
  const indexPreload = read("src/preload/index.js");
  const utils = read("tools/utils.js");
  const mainProcess = read("main.js");
  const packageJson = read("package.json");
  const pluginPackageExists = exists("src/plugin-package.js");
  const pluginPackage = pluginPackageExists ? read("src/plugin-package.js") : "";
  const pluginSyncExists = exists("src/plugin-sync.js");
  const pluginSync = pluginSyncExists ? read("src/plugin-sync.js") : "";
  const buildSyncExists = exists("tools/sync-builtin-plugin.js");
  const buildSync = buildSyncExists ? read("tools/sync-builtin-plugin.js") : "";

  record(
    risks,
    "PLUGIN-NPM-CONTRACT-MISSING",
    pluginPackageExists &&
      pluginPackage.includes("@amdosion/vue3-print") &&
      pluginPackage.includes("%40amdosion%2Fvue3-print"),
    "src/plugin-package.js should define the official @amdosion/vue3-print npm registry contract.",
  );

  record(
    risks,
    "PLUGIN-SETTINGS-STILL-SELECTS-VERSION",
    !setHtml.includes('prop: "pluginVersion",\n                  is: "el-select"') &&
      !setHtml.includes("getVersions()") &&
      !setHtml.includes("downloadPlugin") &&
      !setHtml.includes("syncBuiltinPlugin") &&
      !setHtml.includes("内置渲染插件"),
    "settings should not expose built-in plugin version selection or manual plugin download/sync controls.",
  );

  record(
    risks,
    "PLUGIN-VERSION-EXPOSED-IN-MAIN-UI",
    !indexHtml.includes("内置渲染插件") &&
      !indexHtml.includes("pluginVersion: ipc.pluginVersion") &&
      !indexPreload.includes("pluginVersion:"),
    "the EXE UI should not expose the internal built-in plugin version.",
  );

  record(
    risks,
    "PLUGIN-DOWNLOAD-USES-OLD-PACKAGE",
    !setMain.includes("registry.npmmirror.com/vue-plugin-hiprint") &&
      pluginSync.includes("PLUGIN_PACKAGE_VERSION_URL") &&
      pluginSync.includes("assertTrustedPluginTarballUrl"),
    "plugin sync should use the @amdosion/vue3-print package metadata URL.",
  );

  record(
    risks,
    "PLUGIN-DIST-MAP-MISSING",
    pluginPackage.includes("vue-plugin-hiprint.js") &&
      pluginPackage.includes("vue3-print.css") &&
      pluginPackage.includes("print-lock.css") &&
      pluginPackage.includes("cacheName"),
    "download should map the npm dist files into the existing renderer cache filenames.",
  );

  record(
    risks,
    "PLUGIN-INCOMPATIBLE-PACKAGE-NOT-DIAGNOSED",
    pluginSync.includes("formatMissingPluginFiles") &&
      pluginPackage.includes("Electron 内置渲染") &&
      renderHtml.includes("@amdosion/vue3-print"),
    "missing browser/global plugin files should produce a targeted diagnostic instead of a generic failure or blank renderer.",
  );

  record(
    risks,
    "PLUGIN-RUNTIME-AUTO-SYNC-MISSING",
    pluginSyncExists &&
      pluginSync.includes("syncLatestBuiltinPluginWithFallback") &&
      pluginSync.includes('store.set("pluginVersion"') &&
      mainProcess.includes("syncLatestBuiltinPluginWithFallback") &&
      mainProcess.indexOf("await ensureBuiltinPlugin()") <
        mainProcess.indexOf("await renderSetup()"),
    "client startup should auto-sync npm latest and set pluginVersion before creating the render window.",
  );

  record(
    risks,
    "PLUGIN-BUILD-PREFETCH-MISSING",
    buildSyncExists &&
      buildSync.includes("PLUGIN_PACKAGE_METADATA_URL") &&
      buildSync.includes("verifyNpmIntegrity") &&
      packageJson.includes('"sync-plugin"') &&
      packageJson.includes("npm run sync-plugin && electron-builder"),
    "packaging should prefetch npm latest into plugin/ so the installer carries the current built-in plugin.",
  );

  record(
    risks,
    "PLUGIN-RENDERER-PROCESS-SHIM-MISSING",
    renderHtml.includes("window.process") &&
      renderHtml.includes("process.env") &&
      renderHtml.includes("NODE_ENV"),
    "the browser renderer should define a minimal process.env shim before loading the npm IIFE plugin.",
  );

  record(
    risks,
    "PLUGIN-ERROR-COPY-STILL-POINTS-TO-SETTINGS",
    !renderHtml.includes("在设置中") && !renderHtml.includes("指定版本"),
    "plugin runtime errors should not tell users to choose a built-in plugin version in settings.",
  );

  record(
    risks,
    "PLUGIN-DOWNLOAD-ERROR-HIDES-CAUSE",
    mainProcess.includes("内置渲染插件自动同步失败") &&
      mainProcess.includes("error.message"),
    "startup plugin sync errors should be logged with the actual npm/package compatibility error.",
  );

  record(
    risks,
    "PLUGIN-DEFAULT-STILL-HARDCODED-OLD",
    !utils.includes('default: "1.0.4"'),
    "default plugin version should no longer be a fixed 1.0.4 string.",
  );

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        observed: risks.length,
        risks,
      },
      null,
      2,
    ),
  );

  if (risks.length > 0) {
    process.exitCode = 1;
  }
}

main();
