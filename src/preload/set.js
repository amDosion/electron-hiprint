"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const Store = require("electron-store");

const store = new Store();
const sendChannels = new Set([
  "setConfig",
  "setContentSize",
  "showOpenDialog",
  "openDirectory",
  "testTransit",
  "closeSetWindow",
  "downloadPlugin",
  "checkOnlineUpgrade",
  "getPrintersList",
]);
const onChannels = new Set([
  "downloadedVersions",
  "getPrintersList",
  "onlineUpdateStatus",
  "openDialog",
]);

contextBridge.exposeInMainWorld("hiprintSet", {
  store: store.store,
  send(channel, data) {
    if (sendChannels.has(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  on(channel, callback) {
    if (onChannels.has(channel) && typeof callback === "function") {
      ipcRenderer.on(channel, callback);
    }
  },
  once(channel, callback) {
    if (onChannels.has(channel) && typeof callback === "function") {
      ipcRenderer.once(channel, callback);
    }
  },
  removeAllListeners(channel) {
    if (onChannels.has(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
});
