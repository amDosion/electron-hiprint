"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const WINDOWS_UPGRADE_INSTALLER_ARGS = ["/KEEP_APP_DATA"];
const LAUNCHER_LOG_FILE = "hiprint-online-upgrade-launcher.log";
const DEFAULT_LAUNCHER_READY_TIMEOUT_MS = 5000;

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

function getLauncherId(waitPid) {
  return `${waitPid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDeferredInstallerScript(options = {}) {
  const installerPath = options.installerPath;
  const waitPid = Number(options.waitPid || process.pid);
  const installerArgs = options.installerArgs || WINDOWS_UPGRADE_INSTALLER_ARGS;
  const launcherLogPath = options.launcherLogPath || getLauncherLogPath();
  const launcherId = options.launcherId || getLauncherId(waitPid);

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
      `ready ${launcherId}`,
    )}`,
    `Write-LauncherLog ${quotePowerShellSingleQuoted(
      `wait pid ${waitPid}`,
    )}`,
    `Wait-Process -Id ${waitPid} -ErrorAction SilentlyContinue`,
    'Write-LauncherLog "launch: $installer $($installerArgs -join \' \')"',
    "try {",
    "  $process = Start-Process -FilePath $installer -ArgumentList $installerArgs -WindowStyle Normal -PassThru -ErrorAction Stop",
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

function waitForLauncherReady(options = {}) {
  const launcherLogPath = options.launcherLogPath || getLauncherLogPath();
  const launcherId = options.launcherId;
  const timeoutMs = Number(
    options.timeoutMs || DEFAULT_LAUNCHER_READY_TIMEOUT_MS,
  );
  const intervalMs = Number(options.intervalMs || 100);

  if (!launcherId) {
    return Promise.reject(new Error("启动器 ready 标识不能为空"));
  }

  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    function poll() {
      try {
        if (fs.existsSync(launcherLogPath)) {
          const launcherLog = fs.readFileSync(launcherLogPath, "utf8");
          if (launcherLog.includes(`ready ${launcherId}`)) {
            resolve();
            return;
          }
        }
      } catch (error) {
        reject(error);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error("升级安装器启动器未确认就绪"));
        return;
      }

      setTimeout(poll, intervalMs);
    }

    poll();
  });
}

function launchInstallerAfterProcessExit(installerPath, options = {}) {
  return new Promise((resolve, reject) => {
    const waitPid = options.waitPid || process.pid;
    const launcherLogPath = options.launcherLogPath || getLauncherLogPath();
    const launcherId = options.launcherId || getLauncherId(waitPid);
    const script = buildDeferredInstallerScript({
      installerPath,
      waitPid,
      installerArgs: options.installerArgs || WINDOWS_UPGRADE_INSTALLER_ARGS,
      launcherLogPath,
      launcherId,
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
        stdio: "ignore",
        windowsHide: true,
      },
    );
    launcher.once("error", reject);
    launcher.once("spawn", () => {
      waitForLauncherReady({
        launcherLogPath,
        launcherId,
        timeoutMs: options.readyTimeoutMs,
      })
        .then(() => {
          launcher.unref();
          resolve();
        })
        .catch(reject);
    });
  });
}

module.exports = {
  DEFAULT_LAUNCHER_READY_TIMEOUT_MS,
  LAUNCHER_LOG_FILE,
  WINDOWS_UPGRADE_INSTALLER_ARGS,
  buildDeferredInstallerScript,
  getLauncherId,
  getLauncherLogPath,
  launchInstallerAfterProcessExit,
  quotePowerShellSingleQuoted,
  waitForLauncherReady,
  writeLauncherScript,
};
