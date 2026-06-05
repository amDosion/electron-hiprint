"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");

function readText(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const setJs = readText("src/set.js");
const preloadSetJs = readText("src/preload/set.js");
const setHtml = readText("assets/set.html");
const updaterPath = path.join(repoRoot, "src/online-update.js");
const updaterText = readText("src/online-update.js");
const risks = [];

function expect(condition, id, severity, detail) {
  if (!condition) {
    risks.push({ id, severity, detail });
  }
}

expect(
  fs.existsSync(updaterPath),
  "UPDATER-MODULE-MISSING",
  "high",
  "Online upgrade logic should live in a testable main-process module.",
);

expect(
  /GITHUB_OWNER\s*=\s*"amDosion"/.test(updaterText) &&
    /GITHUB_REPO\s*=\s*"electron-hiprint"/.test(updaterText) &&
    /releases\/latest/.test(updaterText) &&
    /getLatestGithubRelease/.test(setJs),
  "UPDATER-GITHUB-LATEST-NOT-USED",
  "high",
  "Online upgrade should check the repository's latest GitHub Release.",
);

expect(
  /parseGithubDigest|verifyDownloadedInstaller/.test(updaterText) &&
    /digest/.test(updaterText) &&
    /sha256/i.test(updaterText),
  "UPDATER-ASSET-DIGEST-NOT-VERIFIED",
  "critical",
  "Downloaded installers must be verified against the GitHub release asset SHA256 digest before execution.",
);

expect(
  /spawn\(/.test(setJs) && /\/S/.test(setJs),
  "UPDATER-INSTALLER-NOT-LAUNCHED",
  "high",
  "A verified Windows installer should be launched with the silent upgrade argument.",
);

expect(
  /checkOnlineUpgrade/.test(preloadSetJs) &&
    /onlineUpdateStatus/.test(preloadSetJs),
  "UPDATER-IPC-NOT-EXPOSED",
  "high",
  "The settings preload should explicitly allow the online upgrade send/status channels.",
);

expect(
  /checkOnlineUpgrade/.test(setHtml) && /在线升级|检查升级/.test(setHtml),
  "UPDATER-SETTINGS-BUTTON-MISSING",
  "medium",
  "The settings UI should expose an online upgrade button.",
);

if (fs.existsSync(updaterPath)) {
  const updater = require(updaterPath);
  expect(
    updater.compareVersions("1.0.21", "1.0.20") > 0 &&
      updater.compareVersions("v1.0.20", "1.0.20") === 0 &&
      updater.compareVersions("1.0.19", "1.0.20") < 0,
    "UPDATER-VERSION-COMPARE-BROKEN",
    "high",
    "Version comparison should handle v-prefixed semantic versions.",
  );

  const release = {
    tag_name: "v1.0.21",
    assets: [
      {
        name: "hiprint_win_x64-1.0.21.exe",
        size: 1234,
        digest:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        browser_download_url:
          "https://github.com/amDosion/electron-hiprint/releases/download/v1.0.21/hiprint_win_x64-1.0.21.exe",
      },
    ],
  };
  expect(
    updater.selectReleaseAsset(release, "win32", "x64").name ===
      "hiprint_win_x64-1.0.21.exe",
    "UPDATER-WINDOWS-ASSET-SELECTION-BROKEN",
    "high",
    "Windows x64 update should choose the win_x64 NSIS installer asset.",
  );

  expect(
    updater.parseGithubDigest(release.assets[0].digest).algorithm === "sha256",
    "UPDATER-DIGEST-PARSE-BROKEN",
    "high",
    "GitHub asset digest should be parsed as a sha256 hex digest.",
  );

  let rejectedUntrustedUrl = false;
  try {
    updater.assertTrustedUpdateUrl("http://example.com/hiprint.exe");
  } catch {
    rejectedUntrustedUrl = true;
  }
  expect(
    rejectedUntrustedUrl,
    "UPDATER-UNTRUSTED-URL-ACCEPTED",
    "critical",
    "Updater should reject non-HTTPS or non-GitHub download URLs.",
  );
}

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
