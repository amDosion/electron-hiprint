"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const onChannels = new Set(["png", "pdf", "print"]);
const sendChannels = new Set([
  "capturePage",
  "printToPDF",
  "print",
  "showMessageBox",
]);

contextBridge.exposeInMainWorld("hiprintRender", {
  pluginVersion: ipcRenderer.sendSync("hiprint:store-get", "pluginVersion"),
  on(channel, callback) {
    if (onChannels.has(channel) && typeof callback === "function") {
      ipcRenderer.on(channel, (event, data) => callback(data));
    }
  },
  send(channel, data) {
    if (sendChannels.has(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
});
