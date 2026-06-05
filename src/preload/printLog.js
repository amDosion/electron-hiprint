"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const Store = require("electron-store");

const store = new Store();
const sendChannels = new Set(["request-logs", "clear-logs", "reprint"]);

contextBridge.exposeInMainWorld("hiprintPrintLog", {
  rePrintAble: store.get("rePrint"),
  send(channel, data) {
    if (sendChannels.has(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  onPrintLogs(callback) {
    if (typeof callback === "function") {
      ipcRenderer.on("print-logs", callback);
    }
  },
});
