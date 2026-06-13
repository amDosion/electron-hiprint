"use strict";

const { WebContentsView } = require("electron");

function attachLoadingView(targetWindow, windowOptions, loadingUrl) {
  if (!targetWindow || !targetWindow.contentView || !targetWindow.webContents) {
    throw new TypeError("attachLoadingView requires a BrowserWindow instance");
  }

  const loadingContentView = new WebContentsView();
  targetWindow.contentView.addChildView(loadingContentView);
  loadingContentView.setBounds({
    x: 0,
    y: 0,
    width: windowOptions.width,
    height: windowOptions.height,
  });

  let removed = false;

  const cleanupListeners = () => {
    if (!targetWindow.isDestroyed()) {
      targetWindow.webContents.removeListener("dom-ready", removeLoadingView);
      targetWindow.webContents.removeListener(
        "did-finish-load",
        removeLoadingView,
      );
      targetWindow.webContents.removeListener("did-fail-load", removeLoadingView);
      targetWindow.removeListener("closed", removeLoadingView);
    }
    const loadingWebContents = loadingContentView.webContents;
    if (loadingWebContents && !loadingWebContents.isDestroyed()) {
      loadingWebContents.removeListener("did-fail-load", onLoadingFailed);
    }
  };

  const removeLoadingView = () => {
    if (removed) return false;
    removed = true;
    cleanupListeners();

    if (!targetWindow.isDestroyed()) {
      targetWindow.contentView.removeChildView(loadingContentView);
    }
    const loadingWebContents = loadingContentView.webContents;
    if (loadingWebContents && !loadingWebContents.isDestroyed()) {
      loadingWebContents.destroy();
    }
    return true;
  };

  const onLoadingFailed = (_event, code, description, url) => {
    if (removed) return;
    console.error(
      `加载等待页失败: ${description || code}${url ? ` (${url})` : ""}`,
    );
    removeLoadingView();
  };

  targetWindow.webContents.once("dom-ready", removeLoadingView);
  targetWindow.webContents.once("did-finish-load", removeLoadingView);
  targetWindow.webContents.once("did-fail-load", removeLoadingView);
  targetWindow.once("closed", removeLoadingView);
  loadingContentView.webContents.once("did-fail-load", onLoadingFailed);
  loadingContentView.webContents.loadURL(loadingUrl).catch((error) => {
    if (removed) return;
    console.error(`加载等待页失败: ${error.message}`);
    removeLoadingView();
  });

  return {
    view: loadingContentView,
    remove: removeLoadingView,
    isRemoved: () => removed,
  };
}

module.exports = {
  attachLoadingView,
};
