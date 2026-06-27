"use strict";

const os = require("os");

function emitClientInfo(socket, deps) {
  const {
    address,
    store,
    app,
    getMachineId,
    getExportCapability,
  } = deps;
  address
    .mac()
    .then((mac) => {
      const defaultPrinter = store.get("defaultPrinter", "");
      const bindHost = store.get("bindHost") || "127.0.0.1";
      const clientHost =
        bindHost === "0.0.0.0" || bindHost === "::" ? address.ip() : bindHost;
      socket.emit("clientInfo", {
        hostname: os.hostname(), // 主机名
        version: app.getVersion(), // 版本号
        platform: process.platform, // 平台
        arch: process.arch, // 系统架构
        mac: mac, // mac 地址
        ip: address.ip(), // ip 地址
        ipv6: address.ipv6(), // ipv6 地址
        clientUrl: `http://${clientHost}:${store.get("port") || 17521}`, // 客户端地址
        machineId: getMachineId(), // 客户端唯一id
        nickName: store.get("nickName"), // 客户端昵称
        defaultPrinter, // 客户端高级设置里的默认打印机
        capabilities: {
          print: { enabled: true },
          fileExport: getExportCapability(),
        },
      });
    })
    .catch((err) => {
      // address.mac() 不会 reject，但 then 体内（如 socket.emit）若同步抛出，
      // 无 catch 会成为不可见的 unhandledRejection；记录以便排查
      console.error("emitClientInfo failed", err);
    });
}

function getPrintBusy(printRunner) {
  return !!(
    printRunner &&
    typeof printRunner.isBusy === "function" &&
    printRunner.isBusy()
  );
}

function getConnectionStatus({
  socketServer,
  socketClient,
  transitConnectionError,
  printRunner,
}) {
  const clientsCount =
    socketServer && socketServer.engine && Number(socketServer.engine.clientsCount);
  const transitConnected = !!(socketClient && socketClient.connected);

  return {
    localClientCount: Number.isFinite(clientsCount) ? clientsCount : 0,
    transitConnected,
    transitErrorMessage: transitConnected ? "" : transitConnectionError,
    printing: getPrintBusy(printRunner),
  };
}

function sendMainWindow({ getAppWindow, channel, payload }) {
  const win = getAppWindow();
  const webContents = win && !win.isDestroyed() ? win.webContents : null;
  if (!webContents || webContents.isDestroyed()) return false;
  webContents.send(channel, payload);
  return true;
}

function emitConnectionStatus({ getAppWindow, webContents, status }) {
  const win = getAppWindow();
  const target =
    webContents || (win && !win.isDestroyed() ? win.webContents : null);
  if (!target || target.isDestroyed()) return false;
  target.send("connectionStatus", status);
  return true;
}

module.exports = {
  emitClientInfo,
  getPrintBusy,
  getConnectionStatus,
  sendMainWindow,
  emitConnectionStatus,
};
