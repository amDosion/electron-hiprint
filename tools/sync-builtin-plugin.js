"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const zlib = require("node:zlib");
const {
  PLUGIN_DIST_FILE_MAP,
  PLUGIN_PACKAGE_METADATA_URL,
  PLUGIN_PACKAGE_NAME,
  PLUGIN_PACKAGE_VERSION_URL,
  formatMissingPluginFiles,
  getPluginCacheFileName,
  getPluginSourceNames,
} = require("../src/plugin-package");

const repoRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(repoRoot, "plugin");

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

function extractDistFilesFromTarball(tarballBuffer) {
  const tarBuffer = zlib.gunzipSync(tarballBuffer);
  const wanted = new Map();
  for (const item of PLUGIN_DIST_FILE_MAP) {
    getPluginSourceNames(item).forEach((sourceName, priority) => {
      wanted.set(`package/dist/${sourceName}`, {
        cacheName: item.cacheName,
        priority,
      });
    });
  }
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
      const candidate = wanted.get(name);
      const current = extracted[candidate.cacheName];
      if (!current || candidate.priority < current.priority) {
        extracted[candidate.cacheName] = {
          content: Buffer.from(tarBuffer.subarray(dataStart, dataEnd)),
          priority: candidate.priority,
        };
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return extracted;
}

async function resolveLatestVersion() {
  const metadata = JSON.parse(
    (await httpsGetBuffer(PLUGIN_PACKAGE_METADATA_URL)).toString("utf8"),
  );
  if (metadata.name !== PLUGIN_PACKAGE_NAME) {
    throw new Error(`插件包名不匹配：${metadata.name}`);
  }
  const latest = metadata["dist-tags"] && metadata["dist-tags"].latest;
  if (!latest) {
    throw new Error("插件 npm 元数据缺少 latest 版本");
  }
  return latest;
}

async function syncVersion(version) {
  const metadata = JSON.parse(
    (await httpsGetBuffer(PLUGIN_PACKAGE_VERSION_URL(version))).toString("utf8"),
  );
  if (metadata.name && metadata.name !== PLUGIN_PACKAGE_NAME) {
    throw new Error(`插件包名不匹配：${metadata.name}`);
  }
  const tarballUrl = metadata.dist && metadata.dist.tarball;
  const integrity = metadata.dist && metadata.dist.integrity;
  if (!tarballUrl || !integrity) {
    throw new Error("插件元数据缺少 tarball 或 integrity");
  }
  assertTrustedPluginTarballUrl(tarballUrl);

  const tarball = await httpsGetBuffer(tarballUrl);
  verifyNpmIntegrity(tarball, integrity);
  const extracted = extractDistFilesFromTarball(tarball);
  const missingFiles = PLUGIN_DIST_FILE_MAP.filter(
    ({ required, cacheName }) => required && !extracted[cacheName],
  );
  if (missingFiles.length > 0) {
    throw new Error(formatMissingPluginFiles(version, missingFiles));
  }

  fs.mkdirSync(pluginDir, { recursive: true });
  for (const { cacheName } of PLUGIN_DIST_FILE_MAP) {
    const extractedFile = extracted[cacheName];
    if (!extractedFile) continue;
    const filePath = path.join(
      pluginDir,
      getPluginCacheFileName(version, cacheName),
    );
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, extractedFile.content, { flag: "wx" });
    fs.renameSync(tempPath, filePath);
  }

  return { packageName: PLUGIN_PACKAGE_NAME, version, pluginDir };
}

async function main() {
  const versionArgIndex = process.argv.indexOf("--version");
  const version =
    versionArgIndex >= 0 && process.argv[versionArgIndex + 1]
      ? process.argv[versionArgIndex + 1]
      : await resolveLatestVersion();
  const result = await syncVersion(version);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
