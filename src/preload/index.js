"use strict";

const { contextBridge, ipcRenderer, clipboard } = require("electron");
const Store = require("electron-store");
const { version } = require("../../package.json");

const store = new Store();
const sendChannels = new Set([
  "getMachineId",
  "getAddress",
  "getConnectionStatus",
  "openSetting",
  "notification",
]);
const onChannels = new Set([
  "machineId",
  "address",
  "connectionStatus",
  "serverConnection",
  "printTask",
  "clientConnection",
]);

contextBridge.exposeInMainWorld("hiprintIndex", {
  title: store.get("mainTitle") || "Electron-hiprint",
  version,
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
  writeText(text) {
    clipboard.writeText(String(text || ""));
  },
});
