"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "../../..");
const installerPath = path.join(repoRoot, "installer.nsh");
const npmrcPath = path.join(repoRoot, ".npmrc");

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function getMacro(content, name) {
  const pattern = new RegExp(`!macro\\s+${name}\\b([\\s\\S]*?)!macroend`, "i");
  const match = content.match(pattern);
  return match ? match[1] : "";
}

function indexOfRequired(block, pattern) {
  const index = block.search(pattern);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

const installer = readIfExists(installerPath);
const customInstall = getMacro(installer, "customInstall");
const customUnInstall = getMacro(installer, "customUnInstall");
const npmrc = readIfExists(npmrcPath);
const risks = [];

const configSeedIndex = indexOfRequired(customInstall, /CopyFiles\s+"\$EXEDIR\\config\.json"/i);
const appConfigGuardIndex = indexOfRequired(
  customInstall,
  /IfFileExists\s+"\$APPDATA\\electron-hiprint\\config\.json"/i,
);

if (!customInstall || !Number.isFinite(configSeedIndex)) {
  risks.push({
    id: "NSIS-CONFIG-SEED-MISSING",
    severity: "medium",
    detail: "customInstall should support seeding config.json from the installer directory.",
  });
} else if (appConfigGuardIndex > configSeedIndex) {
  risks.push({
    id: "NSIS-CONFIG-SEED-OVERWRITES-EXISTING",
    severity: "high",
    detail:
      "customInstall copies EXEDIR config.json before checking whether AppData config.json already exists.",
  });
}

const messageBoxIndex = indexOfRequired(customUnInstall, /MessageBox\s+MB_YESNO/i);
const rmAppDataIndex = indexOfRequired(
  customUnInstall,
  /RMDir\s+\/r\s+"\$APPDATA\\electron-hiprint"/i,
);
const hasUpdatedGuard =
  /\$\{if\}\s+\$\{isUpdated\}/i.test(customUnInstall) ||
  /--updated/i.test(customUnInstall);
const keepDataIndex = indexOfRequired(customUnInstall, /\/KEEP_APP_DATA/i);
const silentIndex = indexOfRequired(customUnInstall, /\$\{Silent\}/i);
const deleteDataIndex = indexOfRequired(customUnInstall, /--delete-app-data/i);

if (!customUnInstall || !Number.isFinite(messageBoxIndex)) {
  risks.push({
    id: "NSIS-UNINSTALL-DATA-PROMPT-MISSING",
    severity: "medium",
    detail: "customUnInstall should define the explicit manual-uninstall data deletion prompt.",
  });
} else {
  if (!hasUpdatedGuard || keepDataIndex > messageBoxIndex) {
    risks.push({
      id: "NSIS-UPGRADE-UNINSTALL-PROMPTS-DATA-DELETE",
      severity: "high",
      detail:
        "Upgrade uninstall path must honor --updated or /KEEP_APP_DATA before showing the data deletion prompt.",
    });
  }
  if (silentIndex > messageBoxIndex) {
    risks.push({
      id: "NSIS-SILENT-UNINSTALL-CAN-PROMPT-OR-DELETE-DATA",
      severity: "high",
      detail:
        "Silent uninstall must skip the manual MessageBox path unless --delete-app-data is explicitly passed.",
    });
  }
  if (deleteDataIndex > rmAppDataIndex) {
    risks.push({
      id: "NSIS-DELETE-APP-DATA-FLAG-NOT-HONORED",
      severity: "medium",
      detail: "customUnInstall should honor --delete-app-data for explicit cleanup automation.",
    });
  }
}

if (/^\s*electron_mirror\s*=/im.test(npmrc) || /^\s*electron_builder_binaries_mirror\s*=/im.test(npmrc)) {
  risks.push({
    id: "NPM-LEGACY-MIRROR-CONFIG-WARNINGS",
    severity: "low",
    detail:
      ".npmrc contains legacy Electron mirror project config keys that npm 11 reports as unknown project config.",
  });
}

const result = {
  repoRoot,
  observed: risks.length,
  risks,
};

console.log(JSON.stringify(result, null, 2));
process.exitCode = risks.length > 0 ? 1 : 0;
