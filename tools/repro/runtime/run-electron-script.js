"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureElectronInstall() {
  const electronDir = path.join(repoRoot, "node_modules", "electron");
  const pathFile = path.join(electronDir, "path.txt");
  if (fs.existsSync(pathFile)) return;

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
  if (!fs.existsSync(pathFile)) {
    fail(`Electron install script did not create ${pathFile}`);
  }
}

function main() {
  const [script, ...scriptArgs] = process.argv.slice(2);
  if (!script) {
    fail("Usage: node tools/repro/runtime/run-electron-script.js <script> [...args]");
  }

  const scriptPath = path.resolve(repoRoot, script);
  if (!fs.existsSync(scriptPath)) {
    fail(`Electron script does not exist: ${scriptPath}`);
  }

  ensureElectronInstall();
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

main();
