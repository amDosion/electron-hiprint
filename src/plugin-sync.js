"use strict";

const { app } = require("electron");
const path = require("node:path");
const { store } = require("../tools/utils");
const {
  FALLBACK_PLUGIN_VERSION,
  getCompatiblePluginVersions,
  getLatestCompatiblePluginVersion,
} = require("./plugin-package");

function getPluginDir() {
  return app.isPackaged
    ? path.join(app.getAppPath(), "../", "plugin")
    : path.join(app.getAppPath(), "plugin");
}

function setCurrentPluginVersion(version) {
  if (version && store.get("pluginVersion") !== version) {
    store.set("pluginVersion", version);
  }
}

/**
 * 运行时不再联网拉取插件。
 *
 * 插件（@amdosion/vue3-print 的 dist 产物）在「构建期」由
 * tools/sync-builtin-plugin.js 从 npm 拉取并烘焙进安装包的 plugin/ 目录，
 * 整包通过 GitHub Release + 在线升级分发。客户端启动时只需从随包发布的
 * plugin/ 目录解析出「已烘焙的最新兼容版本」，写入 store 供渲染窗口加载。
 *
 * 这样避免了运行时执行远程下载代码的安全/可靠性问题，也消除了原先 npm
 * 不可达时「静默回退旧版、检测不到新版」的故障。要更新插件 = 发新客户端包。
 *
 * @returns {{ pluginVersion: string, availableVersions: string[] }}
 */
function resolveBuiltinPluginVersion() {
  const pluginDir = getPluginDir();
  const availableVersions = getCompatiblePluginVersions(pluginDir);
  const pluginVersion =
    getLatestCompatiblePluginVersion(pluginDir) || FALLBACK_PLUGIN_VERSION;
  setCurrentPluginVersion(pluginVersion);
  return { pluginVersion, availableVersions };
}

module.exports = {
  getPluginDir,
  resolveBuiltinPluginVersion,
  setCurrentPluginVersion,
};
