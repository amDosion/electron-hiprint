"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const sendChannels = new Set([
  "setConfig",
  "setContentSize",
  "showOpenDialog",
  "openDirectory",
  "testTransit",
  "closeSetWindow",
  "getPrintersList",
]);
const onChannels = new Set([
  "getPrintersList",
  "openDialog",
  "testTransitResult",
]);

contextBridge.exposeInMainWorld("hiprintSet", {
  store: ipcRenderer.sendSync("hiprint:settings-snapshot"),
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
