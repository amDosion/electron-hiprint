"use strict";

const { contextBridge, ipcRenderer } = require("electron");

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
  title:
    ipcRenderer.sendSync("hiprint:store-get", "mainTitle") ||
    "Electron-hiprint",
  version: ipcRenderer.sendSync("hiprint:app-version"),
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
    ipcRenderer.send("hiprint:clipboard-write", String(text || ""));
  },
});
