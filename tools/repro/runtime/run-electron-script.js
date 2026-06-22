"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function getElectronPlatform() {
  return (
    process.env.ELECTRON_INSTALL_PLATFORM ||
    process.env.npm_config_platform ||
    process.platform
  );
}

function getElectronArch() {
  return (
    process.env.ELECTRON_INSTALL_ARCH ||
    process.env.npm_config_arch ||
    process.arch
  );
}

function getElectronPlatformPath(platform = getElectronPlatform()) {
  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "win32":
      return "electron.exe";
    case "freebsd":
    case "openbsd":
    case "linux":
      return "electron";
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

function getElectronDistRoot(electronDir) {
  return process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(electronDir, "dist");
}

function restoreElectronPathFile(electronDir, pathFile) {
  const platformPath = getElectronPlatformPath();
  const distRoot = getElectronDistRoot(electronDir);
  const electronBinary = path.join(distRoot, platformPath);
  if (!fs.existsSync(electronBinary)) return false;
  fs.writeFileSync(pathFile, platformPath);
  return true;
}

async function restoreElectronFromArtifact(electronDir, pathFile) {
  let downloadArtifact;
  let extract;
  try {
    ({ downloadArtifact } = require("@electron/get"));
    extract = require("extract-zip");
  } catch (error) {
    fail(`Missing Electron restore dependencies: ${error.message}`);
  }

  const electronPackage = require(path.join(electronDir, "package.json"));
  const checksumsPath = path.join(electronDir, "checksums.json");
  const zipPath = await downloadArtifact({
    version: electronPackage.version,
    artifactName: "electron",
    cacheRoot: process.env.electron_config_cache,
    checksums:
      process.env.electron_use_remote_checksums ||
      process.env.npm_config_electron_use_remote_checksums
        ? undefined
        : require(checksumsPath),
    platform: getElectronPlatform(),
    arch: getElectronArch(),
  });

  const distRoot = getElectronDistRoot(electronDir);
  fs.rmSync(distRoot, { recursive: true, force: true });
  fs.mkdirSync(distRoot, { recursive: true });
  await extract(zipPath, { dir: distRoot });
  const platformPath = getElectronPlatformPath();
  fs.writeFileSync(pathFile, platformPath);
  const electronBinary = path.join(distRoot, platformPath);
  if (!fs.existsSync(electronBinary)) {
    fail(`Restored Electron archive is missing ${electronBinary}`);
  }
}

async function ensureElectronInstall() {
  const electronDir = path.join(repoRoot, "node_modules", "electron");
  const pathFile = path.join(electronDir, "path.txt");
  if (fs.existsSync(pathFile) && restoreElectronPathFile(electronDir, pathFile)) {
    return;
  }
  if (restoreElectronPathFile(electronDir, pathFile)) return;

  const installScript = path.join(electronDir, "install.js");
  if (!fs.existsSync(installScript)) {
    fail(`Missing Electron install script: ${installScript}`);
  }

  const result = spawnSync(process.execPath, [installScript], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    fail(`Failed to restore Electron runtime: ${result.error.message}`);
  }
  if (result.status !== 0) {
    fail(`Electron install script exited with ${result.status}`);
  }
  if (restoreElectronPathFile(electronDir, pathFile)) return;

  try {
    await restoreElectronFromArtifact(electronDir, pathFile);
  } catch (error) {
    fail(
      `Electron install script did not restore ${pathFile}; direct artifact restore failed: ${
        error && error.stack ? error.stack : error
      }`,
    );
  }
}

async function main() {
  const [script, ...scriptArgs] = process.argv.slice(2);
  if (!script) {
    fail("Usage: node tools/repro/runtime/run-electron-script.js <script> [...args]");
  }

  const scriptPath = path.resolve(repoRoot, script);
  if (!fs.existsSync(scriptPath)) {
    fail(`Electron script does not exist: ${scriptPath}`);
  }

  await ensureElectronInstall();
  const electronBin = require(path.join(repoRoot, "node_modules", "electron"));
  const result = spawnSync(electronBin, [scriptPath, ...scriptArgs], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    fail(`Failed to run Electron script: ${result.error.message}`);
  }
  if (result.signal) {
    fail(`Electron script terminated by signal ${result.signal}`);
  }
  process.exit(result.status === null ? 1 : result.status);
}

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
