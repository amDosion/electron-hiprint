"use strict";

const childProcess = require("node:child_process");

const WINDOWS_UPGRADE_INSTALLER_ARGS = ["/KEEP_APP_DATA", "--updated"];

function quotePowerShellSingleQuoted(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildDeferredInstallerScript(options = {}) {
  const installerPath = options.installerPath;
  const waitPid = Number(options.waitPid || process.pid);
  const installerArgs = options.installerArgs || WINDOWS_UPGRADE_INSTALLER_ARGS;

  if (!installerPath) {
    throw new Error("升级安装包路径不能为空");
  }
  if (!Number.isInteger(waitPid) || waitPid <= 0) {
    throw new Error("等待退出的进程 ID 无效");
  }

  const quotedArgs = installerArgs.map(quotePowerShellSingleQuoted).join(", ");
  return [
    "$ErrorActionPreference = 'Stop'",
    `$installer = ${quotePowerShellSingleQuoted(installerPath)}`,
    `$installerArgs = @(${quotedArgs})`,
    `Wait-Process -Id ${waitPid} -ErrorAction SilentlyContinue`,
    "Start-Process -FilePath $installer -ArgumentList $installerArgs",
  ].join("; ");
}

function launchInstallerAfterProcessExit(installerPath, options = {}) {
  return new Promise((resolve, reject) => {
    const script = buildDeferredInstallerScript({
      installerPath,
      waitPid: options.waitPid || process.pid,
      installerArgs: options.installerArgs || WINDOWS_UPGRADE_INSTALLER_ARGS,
    });
    const spawn = options.spawn || childProcess.spawn;
    const launcher = spawn(
      options.powershellPath || "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        script,
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
  WINDOWS_UPGRADE_INSTALLER_ARGS,
  buildDeferredInstallerScript,
  launchInstallerAfterProcessExit,
  quotePowerShellSingleQuoted,
};
