"use strict";

const fs = require("node:fs");
const path = require("node:path");

const PLUGIN_PACKAGE_NAME = "@amdosion/vue3-print";
const PLUGIN_PACKAGE_REGISTRY_PATH = "%40amdosion%2Fvue3-print";
const PLUGIN_PACKAGE_METADATA_URL = `https://registry.npmjs.org/${PLUGIN_PACKAGE_REGISTRY_PATH}`;
const PLUGIN_PACKAGE_VERSION_URL = (version) =>
  `${PLUGIN_PACKAGE_METADATA_URL}/${encodeURIComponent(String(version))}`;
const FALLBACK_PLUGIN_VERSION = "1.0.4";

const PLUGIN_DIST_FILE_MAP = [
  {
    sourceName: "vue3-print.runtime.js",
    cacheName: "vue3-print.runtime.js",
    required: true,
    description: "Electron 内置渲染 browser/global 脚本",
  },
  {
    sourceName: "vue3-print.css",
    cacheName: "style.css",
    required: true,
    description: "插件样式",
  },
  {
    sourceName: "print-lock.css",
    cacheName: "print-lock.css",
    required: true,
    description: "打印锁定样式",
  },
];

const COMPATIBLE_CACHE_REQUIRED_FILES = [
  "vue3-print.runtime.js",
  "print-lock.css",
];

const versionCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function getPluginCacheFileName(version, cacheName) {
  return `${version}_${cacheName}`;
}

function getCompatiblePluginVersions(pluginDir) {
  if (!pluginDir || !fs.existsSync(pluginDir)) {
    return [];
  }

  const files = new Set(fs.readdirSync(pluginDir));
  const versions = new Set();
  for (const fileName of files) {
    const suffix = "_vue3-print.runtime.js";
    if (fileName.endsWith(suffix)) {
      versions.add(fileName.slice(0, -suffix.length));
    }
  }

  return Array.from(versions)
    .filter((version) =>
      COMPATIBLE_CACHE_REQUIRED_FILES.every((cacheName) =>
        files.has(getPluginCacheFileName(version, cacheName)),
      ),
    )
    .sort((left, right) => versionCollator.compare(right, left));
}

function getLatestCompatiblePluginVersion(pluginDir) {
  return getCompatiblePluginVersions(pluginDir)[0] || FALLBACK_PLUGIN_VERSION;
}

function formatMissingPluginFiles(version, missingFiles) {
  const details = missingFiles
    .map(
      ({ sourceName, description }) =>
        `dist/${sourceName}${description ? `（${description}）` : ""}`,
    )
    .join("、");
  return `${PLUGIN_PACKAGE_NAME}@${version} 缺少 Electron 内置渲染所需文件：${details}。请在 npm 包发布 build:electron-plugin 产物后重试。`;
}

module.exports = {
  FALLBACK_PLUGIN_VERSION,
  PLUGIN_DIST_FILE_MAP,
  PLUGIN_PACKAGE_METADATA_URL,
  PLUGIN_PACKAGE_NAME,
  PLUGIN_PACKAGE_VERSION_URL,
  formatMissingPluginFiles,
  getCompatiblePluginVersions,
  getLatestCompatiblePluginVersion,
  getPluginCacheFileName,
};
