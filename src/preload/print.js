"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hiprintPrint", {
  onPrintNew(callback) {
    if (typeof callback === "function") {
      ipcRenderer.on("print-new", (event, data) => callback(data));
    }
  },
  onReprint(callback) {
    if (typeof callback === "function") {
      ipcRenderer.on("reprint", (event, data) => callback(data));
    }
  },
  done(data) {
    ipcRenderer.send("do", data);
  },
});
