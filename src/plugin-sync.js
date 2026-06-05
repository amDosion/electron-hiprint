"use strict";

const { app } = require("electron");
const path = require("node:path");
const https = require("node:https");
const fs = require("node:fs");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { store } = require("../tools/utils");
const {
  FALLBACK_PLUGIN_VERSION,
  PLUGIN_DIST_FILE_MAP,
  PLUGIN_PACKAGE_METADATA_URL,
  PLUGIN_PACKAGE_NAME,
  PLUGIN_PACKAGE_VERSION_URL,
  formatMissingPluginFiles,
  getCompatiblePluginVersions,
  getLatestCompatiblePluginVersion,
  getPluginCacheFileName,
} = require("./plugin-package");

function getPluginDir() {
  return app.isPackaged
    ? path.join(app.getAppPath(), "../", "plugin")
    : path.join(app.getAppPath(), "plugin");
}

function httpsGetBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirects < 3
      ) {
        res.resume();
        const redirectedUrl = new URL(res.headers.location, url).href;
        httpsGetBuffer(redirectedUrl, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`下载失败，HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error("下载超时"));
    });
  });
}

function assertTrustedPluginTarballUrl(tarballUrl) {
  const parsed = new URL(tarballUrl);
  if (parsed.protocol !== "https:" || parsed.hostname !== "registry.npmjs.org") {
    throw new Error(`插件 tarball 来源不可信：${parsed.hostname}`);
  }
}

function verifyNpmIntegrity(buffer, integrity) {
  const [algorithm, expected] = String(integrity).split("-", 2);
  if (!["sha512", "sha384", "sha256"].includes(algorithm) || !expected) {
    throw new Error("插件 integrity 格式不受支持");
  }
  const actual = crypto.createHash(algorithm).update(buffer).digest("base64");
  if (actual !== expected) {
    throw new Error("插件包完整性校验失败");
  }
}

function extractDistFilesFromTarball(tarballBuffer, fileMap) {
  const tarBuffer = zlib.gunzipSync(tarballBuffer);
  const wanted = new Map(
    fileMap.map((item) => [`package/dist/${item.sourceName}`, item.sourceName]),
  );
  const extracted = {};
  let offset = 0;
  while (offset + 512 <= tarBuffer.length) {
    const name = tarBuffer
      .toString("utf8", offset, offset + 100)
      .replace(/\0.*$/, "");
    if (!name) break;
    const sizeText = tarBuffer
      .toString("utf8", offset + 124, offset + 136)
      .replace(/\0.*$/, "")
      .trim();
    const size = parseInt(sizeText, 8) || 0;
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (wanted.has(name)) {
      extracted[wanted.get(name)] = Buffer.from(
        tarBuffer.subarray(dataStart, dataEnd),
      );
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return extracted;
}

async function getLatestPluginVersion() {
  const metadataBuffer = await httpsGetBuffer(PLUGIN_PACKAGE_METADATA_URL);
  const metadata = JSON.parse(metadataBuffer.toString("utf8"));
  if (metadata.name !== PLUGIN_PACKAGE_NAME) {
    throw new Error(`插件包名不匹配：${metadata.name}`);
  }
  const latest = metadata["dist-tags"] && metadata["dist-tags"].latest;
  if (!latest || !metadata.versions || !metadata.versions[latest]) {
    throw new Error("插件 npm 元数据缺少 latest 版本");
  }
  return latest;
}

function isPluginVersionCached(version) {
  const pluginDir = getPluginDir();
  const versions = getCompatiblePluginVersions(pluginDir);
  return versions.includes(version);
}

async function downloadPluginVersion(version) {
  if (!version) {
    throw new Error("插件版本不能为空");
  }
  const metadataBuffer = await httpsGetBuffer(
    PLUGIN_PACKAGE_VERSION_URL(version),
  );
  const metadata = JSON.parse(metadataBuffer.toString("utf8"));
  if (metadata.name && metadata.name !== PLUGIN_PACKAGE_NAME) {
    throw new Error(`插件包名不匹配：${metadata.name}`);
  }
  const tarballUrl = metadata.dist && metadata.dist.tarball;
  const integrity = metadata.dist && metadata.dist.integrity;
  if (!tarballUrl || !integrity) {
    throw new Error("插件元数据缺少 tarball 或 integrity");
  }
  assertTrustedPluginTarballUrl(tarballUrl);

  const tarballBuffer = await httpsGetBuffer(tarballUrl);
  verifyNpmIntegrity(tarballBuffer, integrity);
  const extractedFiles = extractDistFilesFromTarball(
    tarballBuffer,
    PLUGIN_DIST_FILE_MAP,
  );
  const missingFiles = PLUGIN_DIST_FILE_MAP.filter(
    ({ required, sourceName }) => required && !extractedFiles[sourceName],
  );
  if (missingFiles.length > 0) {
    throw new Error(formatMissingPluginFiles(version, missingFiles));
  }

  const pluginDir = getPluginDir();
  fs.mkdirSync(pluginDir, { recursive: true });
  PLUGIN_DIST_FILE_MAP.forEach(({ sourceName, cacheName }) => {
    const content = extractedFiles[sourceName];
    if (!content) {
      return;
    }
    const filePath = path.join(
      pluginDir,
      getPluginCacheFileName(version, cacheName),
    );
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, content, { flag: "wx" });
    fs.renameSync(tempPath, filePath);
  });
}

function setCurrentPluginVersion(version) {
  if (version && store.get("pluginVersion") !== version) {
    store.set("pluginVersion", version);
  }
}

function selectCachedPluginVersion() {
  return getLatestCompatiblePluginVersion(getPluginDir());
}

async function syncLatestBuiltinPlugin() {
  const latestVersion = await getLatestPluginVersion();
  const alreadyCached = isPluginVersionCached(latestVersion);
  if (!alreadyCached) {
    await downloadPluginVersion(latestVersion);
  }
  setCurrentPluginVersion(latestVersion);
  return {
    downloaded: !alreadyCached,
    latestVersion,
    pluginVersion: latestVersion,
  };
}

async function syncLatestBuiltinPluginWithFallback() {
  try {
    return await syncLatestBuiltinPlugin();
  } catch (error) {
    const fallbackVersion = selectCachedPluginVersion() || FALLBACK_PLUGIN_VERSION;
    setCurrentPluginVersion(fallbackVersion);
    error.fallbackVersion = fallbackVersion;
    throw error;
  }
}

module.exports = {
  getCompatiblePluginVersions: () => getCompatiblePluginVersions(getPluginDir()),
  getLatestPluginVersion,
  getPluginDir,
  isPluginVersionCached,
  selectCachedPluginVersion,
  syncLatestBuiltinPlugin,
  syncLatestBuiltinPluginWithFallback,
};
