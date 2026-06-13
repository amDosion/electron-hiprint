"use strict";

const { app, dialog } = require("electron");
const path = require("node:path");
const helper = require("./helper");
const {
  launchInstallerAfterProcessExit,
} = require("./deferred-installer-launcher");
const {
  GITHUB_LATEST_RELEASE_URL,
  compareVersions,
  downloadVerifiedAsset,
  getLatestGithubRelease,
  getReleaseVersion,
  selectReleaseAsset,
} = require("./online-update");

let onlineUpgradeInProgress = false;

function logOnlineUpgrade(message, error) {
  if (error) {
    console.error(`在线升级：${message}`, error);
    return;
  }
  console.log(`在线升级：${message}`);
}

function sendOnlineUpdateStatus(onStatus, status) {
  if (typeof onStatus === "function") {
    onStatus(status);
  }
}

function showMessageBox(parentWindow, options) {
  if (parentWindow && !parentWindow.isDestroyed()) {
    return dialog.showMessageBox(parentWindow, options);
  }
  return dialog.showMessageBox(options);
}

function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || Number(bytes) <= 0) return "未知大小";
  return `${(Number(bytes) / 1048576).toFixed(1)} MB`;
}

async function runOnlineUpgrade(options = {}) {
  const { parentWindow, onStatus, silent = false } = options;
  if (onlineUpgradeInProgress) return { skipped: true, reason: "busy" };
  onlineUpgradeInProgress = true;
  let installerLaunched = false;
  sendOnlineUpdateStatus(onStatus, {
    busy: true,
    state: "checking",
    message: "正在检查客户端更新...",
  });

  try {
    if (!app.isPackaged) {
      logOnlineUpgrade("开发环境跳过在线升级");
      if (!silent) {
        await showMessageBox(parentWindow, {
          type: "info",
          title: "提示",
          message: "开发环境不执行在线升级，请使用安装后的客户端验证。",
          buttons: ["确定"],
          noLink: true,
        });
      }
      return { skipped: true, reason: "development" };
    }

    logOnlineUpgrade("开始检查 GitHub Release");
    const release = await getLatestGithubRelease();
    const latestVersion = getReleaseVersion(release);
    if (!latestVersion) {
      throw new Error("GitHub Release 缺少有效版本号");
    }

    const currentVersion = app.getVersion();
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      logOnlineUpgrade(`当前已是最新版本 ${currentVersion}`);
      if (!silent) {
        await showMessageBox(parentWindow, {
          type: "info",
          title: "提示",
          message: `当前已是最新版本：${currentVersion}`,
          buttons: ["确定"],
          noLink: true,
        });
      }
      return { skipped: true, reason: "latest", currentVersion };
    }

    const asset = selectReleaseAsset(release, process.platform, process.arch);
    logOnlineUpgrade(
      `发现新版本 ${latestVersion}，当前版本 ${currentVersion}，安装包 ${asset.name}`,
    );
    const confirmResult = await showMessageBox(parentWindow, {
      type: "question",
      title: "发现新版本",
      message: `发现新版本 ${latestVersion}，是否下载并升级？`,
      detail: [
        `当前版本：${currentVersion}`,
        `安装包：${asset.name}`,
        `大小：${formatBytes(asset.size)}`,
        `来源：${GITHUB_LATEST_RELEASE_URL}`,
      ].join("\n"),
      buttons: ["下载并升级", "取消"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (confirmResult.response !== 0) {
      logOnlineUpgrade(`用户取消升级到 ${latestVersion}`);
      return { skipped: true, reason: "cancelled", latestVersion };
    }

    const downloadPath = path.join(app.getPath("temp"), asset.name);
    logOnlineUpgrade(`开始下载安装包 ${asset.name}`);
    sendOnlineUpdateStatus(onStatus, {
      busy: true,
      state: "downloading",
      message: `正在下载 ${latestVersion}...`,
    });
    const downloaded = await downloadVerifiedAsset(asset, downloadPath, {
      onProgress: ({ bytes, totalBytes }) => {
        sendOnlineUpdateStatus(onStatus, {
          busy: true,
          state: "downloading",
          message: `正在下载 ${formatBytes(bytes)} / ${formatBytes(
            totalBytes,
          )}`,
        });
      },
    });
    logOnlineUpgrade(
      `安装包校验通过 ${downloaded.filePath} (${downloaded.sha256})`,
    );

    sendOnlineUpdateStatus(onStatus, {
      busy: true,
      state: "installing",
      message: "安装包校验通过，正在退出并打开安装器...",
    });
    await launchInstallerAfterProcessExit(downloaded.filePath);
    installerLaunched = true;
    logOnlineUpgrade("已安排安装器等待当前进程退出后打开");
    helper.appQuit();
    return { installerLaunched: true, latestVersion };
  } catch (error) {
    logOnlineUpgrade("失败", error);
    sendOnlineUpdateStatus(onStatus, {
      busy: false,
      state: "error",
      message: error.message,
    });
    if (!silent) {
      await showMessageBox(parentWindow, {
        type: "error",
        title: "提示",
        message: `在线升级失败：${error.message}`,
        buttons: ["确定"],
        noLink: true,
      });
    }
    return { error };
  } finally {
    onlineUpgradeInProgress = false;
    if (!installerLaunched) {
      sendOnlineUpdateStatus(onStatus, {
        busy: false,
        state: "idle",
        message: "",
      });
    }
  }
}

module.exports = {
  runOnlineUpgrade,
};
