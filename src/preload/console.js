"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// ---- hiprintIndex（原 preload/index.js）----
const indexSend = new Set(["getMachineId","getAddress","getConnectionStatus","openSetting","notification"]);
const indexOn = new Set(["machineId","address","connectionStatus","serverConnection","printTask","clientConnection"]);
contextBridge.exposeInMainWorld("hiprintIndex", {
  title: ipcRenderer.sendSync("hiprint:store-get", "mainTitle") || "Electron-hiprint",
  version: ipcRenderer.sendSync("hiprint:app-version"),
  send(channel, data) { if (indexSend.has(channel)) ipcRenderer.send(channel, data); },
  on(channel, callback) { if (indexOn.has(channel) && typeof callback === "function") ipcRenderer.on(channel, callback); },
  writeText(text) { ipcRenderer.send("hiprint:clipboard-write", String(text || "")); },
});

// ---- hiprintSet（原 preload/set.js）----
const setSend = new Set(["setConfig","setContentSize","showOpenDialog","openDirectory","testTransit","closeSetWindow","getPrintersList"]);
const setOn = new Set(["getPrintersList","openDialog","testTransitResult"]);
contextBridge.exposeInMainWorld("hiprintSet", {
  store: ipcRenderer.sendSync("hiprint:settings-snapshot"),
  send(channel, data) { if (setSend.has(channel)) ipcRenderer.send(channel, data); },
  on(channel, callback) { if (setOn.has(channel) && typeof callback === "function") ipcRenderer.on(channel, callback); },
  once(channel, callback) { if (setOn.has(channel) && typeof callback === "function") ipcRenderer.once(channel, callback); },
  removeAllListeners(channel) { if (setOn.has(channel)) ipcRenderer.removeAllListeners(channel); },
});

// ---- hiprintPrintLog（原 preload/printLog.js）----
const printLogSend = new Set(["request-logs","clear-logs","reprint"]);
contextBridge.exposeInMainWorld("hiprintPrintLog", {
  rePrintAble: ipcRenderer.sendSync("hiprint:store-get", "rePrint"),
  send(channel, data) { if (printLogSend.has(channel)) ipcRenderer.send(channel, data); },
  onPrintLogs(callback) { if (typeof callback === "function") ipcRenderer.on("print-logs", callback); },
});

// ---- hiprintSoftwareLog（原 preload/softwareLog.js）----
contextBridge.exposeInMainWorld("hiprintSoftwareLog", {
  listDates: () => ipcRenderer.invoke("software-log:list-dates"),
  read: (date) => ipcRenderer.invoke("software-log:read", date),
  openFolder: () => ipcRenderer.send("software-log:open-folder"),
  clear: () => ipcRenderer.invoke("software-log:clear"),
});

// ---- 控制台路由导航（主进程 → 渲染端 router.push）----
contextBridge.exposeInMainWorld("hiprintConsole", {
  onNavigate(callback) { if (typeof callback === "function") ipcRenderer.on("console:navigate", (_e, route) => callback(route)); },
});
