"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");

function readText(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

const setJs = readText("src/set.js");
const mainJs = readText("main.js");
const preloadSetJs = readText("src/preload/set.js");
const setHtml = readText("assets/set.html");
const installerNsh = readText("installer.nsh");
const updaterPath = path.join(repoRoot, "src/online-update.js");
const updaterText = readText("src/online-update.js");
const runnerPath = path.join(repoRoot, "src/online-upgrade-runner.js");
const runnerText = readText("src/online-upgrade-runner.js");
const deferredInstallerPath = path.join(
  repoRoot,
  "src/deferred-installer-launcher.js",
);
const deferredInstallerText = readText("src/deferred-installer-launcher.js");
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
  fs.existsSync(runnerPath),
  "UPDATER-RUNNER-MISSING",
  "high",
  "Program-level online upgrade flow should live outside the settings window module.",
);

expect(
  fs.existsSync(deferredInstallerPath),
  "UPDATER-DEFERRED-INSTALLER-MISSING",
  "high",
  "Online upgrade should launch the installer from an external process after the current app exits.",
);

expect(
  /GITHUB_OWNER\s*=\s*"amDosion"/.test(updaterText) &&
    /GITHUB_REPO\s*=\s*"electron-hiprint"/.test(updaterText) &&
    /releases\/latest/.test(updaterText) &&
    /getLatestGithubRelease/.test(runnerText),
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
  /launchInstallerAfterProcessExit/.test(runnerText) &&
    !/["']\/S["']/.test(deferredInstallerText),
  "UPDATER-INSTALLER-NOT-LAUNCHED",
  "high",
  "A verified Windows installer should be launched without forcing silent mode.",
);

expect(
  /launchInstallerAfterProcessExit/.test(runnerText) &&
    !/childProcess\.spawn/.test(runnerText) &&
    !/setTimeout\(\s*\(\)\s*=>\s*{\s*helper\.appQuit/.test(runnerText),
  "UPDATER-INSTALLER-LAUNCHED-BEFORE-QUIT",
  "high",
  "The updater should schedule an external launcher, quit the old app, then start the installer after process exit.",
);

expect(
  /Wait-Process[\s\S]*Start-Process/.test(deferredInstallerText) &&
    /\/KEEP_APP_DATA/.test(deferredInstallerText) &&
    !/--updated/.test(deferredInstallerText) &&
    /windowsHide:\s*true/.test(deferredInstallerText) &&
    !/["']\/S["']/.test(deferredInstallerText) &&
    /-File/.test(deferredInstallerText),
  "UPDATER-DEFERRED-INSTALLER-CONTRACT-BROKEN",
  "high",
  "Deferred launcher should wait for the current process, run a hidden helper script, preserve app data, and keep the installer UI visible.",
);

expect(
  /hiprint-online-upgrade-launcher\.log/.test(deferredInstallerText) &&
    /Out-File/.test(deferredInstallerText) &&
    /FAILED:/.test(deferredInstallerText) &&
    /-PassThru/.test(deferredInstallerText),
  "UPDATER-DEFERRED-INSTALLER-NOT-OBSERVABLE",
  "high",
  "Deferred installer failures should be logged to a temp launcher log instead of being swallowed by a hidden helper.",
);

expect(
  /\$\{if\}\s+\$\{isUpdated\}[\s\S]{0,160}Goto\s+SkipDataDeletion/.test(
    installerNsh,
  ) &&
    /\$\{GetOptions\}\s+\$R0\s+"\/KEEP_APP_DATA"[\s\S]{0,220}Goto\s+SkipDataDeletion/.test(
      installerNsh,
    ),
  "UPDATER-INSTALLER-DATA-PRESERVATION-BROKEN",
  "critical",
  "The NSIS uninstaller should preserve app data on electron-builder upgrade and explicit /KEEP_APP_DATA paths.",
);

expect(
  !/checkOnlineUpgrade/.test(preloadSetJs) &&
    !/onlineUpdateStatus/.test(preloadSetJs) &&
    !/checkOnlineUpgrade/.test(setJs),
  "UPDATER-SETTINGS-IPC-STILL-EXPOSED",
  "high",
  "The settings window should not expose the program-level online upgrade IPC channels.",
);

expect(
  !/checkOnlineUpgrade/.test(setHtml) &&
    !/客户端在线升级/.test(setHtml) &&
    !/检查并在线升级/.test(setHtml),
  "UPDATER-SETTINGS-BUTTON-STILL-PRESENT",
  "medium",
  "The settings UI should not expose the online upgrade button.",
);

expect(
  mainJs.includes('"在线升级"') &&
    mainJs.includes('"升级处理中..."') &&
    /runOnlineUpgrade/.test(mainJs) &&
    /buildTrayMenuTemplate/.test(mainJs),
  "UPDATER-TRAY-MENU-ENTRY-MISSING",
  "high",
  "The tray context menu should expose online upgrade at the same level as settings/logs/about/exit.",
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

if (fs.existsSync(deferredInstallerPath)) {
  const deferredInstaller = require(deferredInstallerPath);
  const script = deferredInstaller.buildDeferredInstallerScript({
    installerPath: "C:\\Temp\\hiprint's test.exe",
    waitPid: 12345,
  });
  expect(
    script.indexOf("Wait-Process") !== -1 &&
      script.indexOf("Start-Process") !== -1 &&
      script.indexOf("Wait-Process") < script.indexOf("Start-Process"),
    "UPDATER-DEFERRED-INSTALLER-ORDER-BROKEN",
    "high",
    "The installer launch script must wait for the old process before starting the installer.",
  );
  expect(
    script.includes("hiprint''s test.exe") &&
      script.includes("hiprint-online-upgrade-launcher.log") &&
      script.includes("Out-File") &&
      script.includes("FAILED:") &&
      script.includes("-PassThru") &&
      !deferredInstaller.WINDOWS_UPGRADE_INSTALLER_ARGS.includes("/S") &&
      deferredInstaller.WINDOWS_UPGRADE_INSTALLER_ARGS.includes(
        "/KEEP_APP_DATA",
      ) &&
      !deferredInstaller.WINDOWS_UPGRADE_INSTALLER_ARGS.includes("--updated"),
    "UPDATER-DEFERRED-INSTALLER-ARGS-BROKEN",
    "high",
    "The installer launch script should quote paths safely, log helper failures, and use visible app-data-preserving arguments.",
  );
}

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
