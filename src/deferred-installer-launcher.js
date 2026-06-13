"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WINDOWS_UPGRADE_INSTALLER_ARGS = ["/KEEP_APP_DATA"];
const LAUNCHER_LOG_FILE = "hiprint-online-upgrade-launcher.log";

function quotePowerShellSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getLauncherLogPath() {
  return path.join(os.tmpdir(), LAUNCHER_LOG_FILE);
}

function getLauncherScriptPath() {
  return path.join(
    os.tmpdir(),
    `hiprint-online-upgrade-launcher-${process.pid}-${Date.now()}.ps1`,
  );
}

function buildDeferredInstallerScript(options = {}) {
  const installerPath = options.installerPath;
  const waitPid = Number(options.waitPid || process.pid);
  const installerArgs = options.installerArgs || WINDOWS_UPGRADE_INSTALLER_ARGS;
  const launcherLogPath = options.launcherLogPath || getLauncherLogPath();

  if (!installerPath) {
    throw new Error("升级安装包路径不能为空");
  }
  if (!Number.isInteger(waitPid) || waitPid <= 0) {
    throw new Error("等待退出的进程 ID 无效");
  }

  const quotedArgs = installerArgs.map(quotePowerShellSingleQuoted).join(", ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$log = ${quotePowerShellSingleQuoted(launcherLogPath)}`,
    "function Write-LauncherLog($message) {",
    "  $timestamp = [DateTime]::Now.ToString('s')",
    '  "$timestamp  $message" | Out-File -FilePath $log -Append -Encoding utf8',
    "}",
    `$installer = ${quotePowerShellSingleQuoted(installerPath)}`,
    `$installerArgs = @(${quotedArgs})`,
    `Write-LauncherLog ${quotePowerShellSingleQuoted(
      `wait pid ${waitPid}`,
    )}`,
    `Wait-Process -Id ${waitPid} -ErrorAction SilentlyContinue`,
    'Write-LauncherLog "launch: $installer $($installerArgs -join \' \')"',
    "try {",
    "  $process = Start-Process -FilePath $installer -ArgumentList $installerArgs -WindowStyle Normal -PassThru",
    '  Write-LauncherLog "started installer pid $($process.Id)"',
    "} catch {",
    '  Write-LauncherLog "FAILED: $($_.Exception.Message)"',
    "  throw",
    "}",
  ].join("\r\n");
}

function writeLauncherScript(script, options = {}) {
  const launcherScriptPath = options.launcherScriptPath || getLauncherScriptPath();
  fs.writeFileSync(launcherScriptPath, script, "utf8");
  return launcherScriptPath;
}

function launchInstallerAfterProcessExit(installerPath, options = {}) {
  return new Promise((resolve, reject) => {
    const script = buildDeferredInstallerScript({
      installerPath,
      waitPid: options.waitPid || process.pid,
      installerArgs: options.installerArgs || WINDOWS_UPGRADE_INSTALLER_ARGS,
    });
    let launcherScriptPath;
    try {
      launcherScriptPath = writeLauncherScript(script, options);
    } catch (error) {
      reject(error);
      return;
    }
    const spawn = options.spawn || childProcess.spawn;
    const launcher = spawn(
      options.powershellPath || "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-File",
        launcherScriptPath,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    launcher.once("error", reject);
    launcher.once("spawn", () => {
      launcher.unref();
      resolve();
    });
  });
}

module.exports = {
  LAUNCHER_LOG_FILE,
  WINDOWS_UPGRADE_INSTALLER_ARGS,
  buildDeferredInstallerScript,
  getLauncherLogPath,
  launchInstallerAfterProcessExit,
  quotePowerShellSingleQuoted,
  writeLauncherScript,
};
