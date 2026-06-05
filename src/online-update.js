"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

const GITHUB_OWNER = "amDosion";
const GITHUB_REPO = "electron-hiprint";
const GITHUB_LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
const MAX_INSTALLER_BYTES = 350 * 1024 * 1024;
const TRUSTED_REDIRECT_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

function normalizeVersion(version) {
  const match = String(version || "").match(/v?(\d+)\.(\d+)\.(\d+)/i);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : "";
}

function versionParts(version) {
  return normalizeVersion(version)
    .split(".")
    .filter(Boolean)
    .map((item) => Number(item));
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (a.length !== 3 || b.length !== 3) {
    throw new Error("版本号格式必须为 x.y.z");
  }
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function getReleaseVersion(release) {
  return normalizeVersion(release && (release.tag_name || release.name));
}

function parseGithubDigest(digest) {
  const match = String(digest || "").match(/^sha256:([a-f0-9]{64})$/i);
  if (!match) {
    throw new Error("GitHub Release 资产缺少有效的 sha256 digest");
  }
  return {
    algorithm: "sha256",
    hex: match[1].toLowerCase(),
  };
}

function assertTrustedUpdateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("升级下载地址不是有效 URL");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("升级下载地址必须使用 HTTPS");
  }
  if (!TRUSTED_REDIRECT_HOSTS.has(parsed.hostname)) {
    throw new Error("升级下载地址不是可信 GitHub 地址");
  }
  if (parsed.hostname === "github.com") {
    const expectedPrefix = `/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/`;
    if (!parsed.pathname.startsWith(expectedPrefix)) {
      throw new Error("升级下载地址不属于当前 GitHub Release");
    }
  }
  return parsed.href;
}

function getAssetNamePattern(platform, arch) {
  if (platform !== "win32") {
    throw new Error("当前在线升级仅支持 Windows NSIS 安装包");
  }
  if (arch === "x64") return /^hiprint_win_x64-\d+\.\d+\.\d+.*\.exe$/i;
  if (arch === "ia32") return /^hiprint_win_x32-\d+\.\d+\.\d+.*\.exe$/i;
  throw new Error(`当前 CPU 架构暂不支持在线升级：${arch}`);
}

function selectReleaseAsset(release, platform, arch) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const pattern = getAssetNamePattern(platform, arch);
  const asset = assets.find((item) => {
    return (
      item &&
      (!item.state || item.state === "uploaded") &&
      pattern.test(String(item.name || "")) &&
      Number(item.size) > 0 &&
      Number(item.size) <= MAX_INSTALLER_BYTES
    );
  });
  if (!asset) {
    throw new Error("未找到匹配当前系统的升级安装包");
  }
  parseGithubDigest(asset.digest);
  assertTrustedUpdateUrl(asset.browser_download_url);
  return asset;
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      assertTrustedUpdateUrl(url),
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `${GITHUB_REPO}-updater`,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`检查升级失败，HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on("error", reject);
    request.setTimeout(30000, () => {
      request.destroy(new Error("检查升级超时"));
    });
  });
}

function getLatestGithubRelease() {
  return httpsGetJson(GITHUB_LATEST_RELEASE_URL);
}

function downloadToTemp(url, tempPath, options = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const trustedUrl = assertTrustedUpdateUrl(url);
    const request = https.get(
      trustedUrl,
      {
        headers: {
          "User-Agent": `${GITHUB_REPO}-updater`,
        },
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirects < 5
        ) {
          res.resume();
          const redirectedUrl = new URL(res.headers.location, trustedUrl).href;
          downloadToTemp(redirectedUrl, tempPath, options, redirects + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`下载安装包失败，HTTP ${res.statusCode}`));
          return;
        }

        const contentLength = Number(res.headers["content-length"] || 0);
        if (contentLength > MAX_INSTALLER_BYTES) {
          res.resume();
          reject(new Error("升级安装包超过大小限制"));
          return;
        }

        let bytes = 0;
        const hash = crypto.createHash("sha256");
        const fileStream = fs.createWriteStream(tempPath, { flags: "wx" });

        res.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_INSTALLER_BYTES) {
            request.destroy(new Error("升级安装包超过大小限制"));
            return;
          }
          hash.update(chunk);
          if (typeof options.onProgress === "function") {
            options.onProgress({
              bytes,
              totalBytes: Number(options.expectedSize) || contentLength || 0,
            });
          }
        });

        res.pipe(fileStream);
        fileStream.on("finish", () => {
          fileStream.close(() => {
            resolve({
              bytes,
              sha256: hash.digest("hex"),
            });
          });
        });
        fileStream.on("error", reject);
      },
    );
    request.on("error", reject);
    request.setTimeout(120000, () => {
      request.destroy(new Error("下载安装包超时"));
    });
  });
}

async function downloadVerifiedAsset(asset, destinationPath, options = {}) {
  const expected = parseGithubDigest(asset.digest);
  const tempPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    const result = await downloadToTemp(asset.browser_download_url, tempPath, {
      expectedSize: asset.size,
      onProgress: options.onProgress,
    });
    if (result.sha256 !== expected.hex) {
      throw new Error("升级安装包 SHA256 校验失败");
    }
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    if (fs.existsSync(destinationPath)) {
      fs.unlinkSync(destinationPath);
    }
    fs.renameSync(tempPath, destinationPath);
    return {
      filePath: destinationPath,
      bytes: result.bytes,
      sha256: result.sha256,
    };
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw error;
  }
}

module.exports = {
  GITHUB_LATEST_RELEASE_URL,
  assertTrustedUpdateUrl,
  compareVersions,
  downloadVerifiedAsset,
  getLatestGithubRelease,
  getReleaseVersion,
  parseGithubDigest,
  selectReleaseAsset,
};
