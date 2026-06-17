"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// 仅暴露软件日志查看器所需的最小面：列出日期、读取某日日志、打开日志文件夹。
// 渲染端无法直接访问 fs / 任意 IPC 通道，所有读取均经主进程白名单校验。
contextBridge.exposeInMainWorld("hiprintSoftwareLog", {
  listDates: () => ipcRenderer.invoke("software-log:list-dates"),
  read: (date) => ipcRenderer.invoke("software-log:read", date),
  openFolder: () => ipcRenderer.send("software-log:open-folder"),
  clear: () => ipcRenderer.invoke("software-log:clear"),
});
