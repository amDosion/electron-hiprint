"use strict";

const WIN32_ELECTRON_READY_STATUSES = new Set([0, 512, 1024]);
const CUPS_READY_STATUS = 3;

const WIN32_BLOCK_STATUS_RE =
  /未找到|未知状态|unknown status|not ready|未就绪|offline|离线|error|错误|缺纸|卡纸|paper|jam/i;
const WIN32_READY_STATUS_RE = /准备就绪|ready|正在打印|printing|忙|busy/i;

function findDefaultPrinter(printers) {
  return printers.find((printer) => printer && printer.isDefault);
}

function normalizeStatusMsg(statusInfo) {
  if (!statusInfo || typeof statusInfo.StatusMsg !== "string") return "";
  return statusInfo.StatusMsg.trim();
}

function isWin32StatusReady(statusMsg) {
  if (!statusMsg || /非Windows系统/.test(statusMsg)) return undefined;
  if (WIN32_BLOCK_STATUS_RE.test(statusMsg)) return false;
  if (WIN32_READY_STATUS_RE.test(statusMsg)) return true;
  return undefined;
}

function isElectronStatusReady(platform, status) {
  if (platform === "win32") return WIN32_ELECTRON_READY_STATUSES.has(status);
  return status === CUPS_READY_STATUS;
}

function getPrinterReadiness({
  platform,
  printers,
  printerName,
  getStatusByName,
}) {
  const printerList = Array.isArray(printers) ? printers : [];
  const requestedName = printerName || "";
  const defaultPrinter = requestedName ? null : findDefaultPrinter(printerList);
  const resolvedName =
    requestedName || (defaultPrinter && defaultPrinter.name) || "";
  const printer =
    printerList.find((item) => item && item.name === resolvedName) ||
    defaultPrinter ||
    null;

  if (resolvedName && !printer) {
    return {
      ready: false,
      printerName: resolvedName,
      statusMsg: "未找到打印机",
      electronStatus: undefined,
    };
  }

  let statusMsg = "";
  if (platform === "win32" && resolvedName && getStatusByName) {
    try {
      statusMsg = normalizeStatusMsg(getStatusByName(resolvedName));
      const win32Ready = isWin32StatusReady(statusMsg);
      if (typeof win32Ready === "boolean") {
        return {
          ready: win32Ready,
          printerName: resolvedName,
          statusMsg,
          electronStatus: printer && printer.status,
        };
      }
    } catch (error) {
      statusMsg = `状态读取失败：${error && error.message ? error.message : error}`;
    }
  }

  if (!printer) {
    return {
      ready: true,
      printerName: resolvedName,
      statusMsg,
      electronStatus: undefined,
    };
  }

  return {
    ready: isElectronStatusReady(platform, printer.status),
    printerName: resolvedName,
    statusMsg,
    electronStatus: printer.status,
  };
}

function formatPrinterStatus(readiness) {
  const statusMsg = readiness && readiness.statusMsg;
  const electronStatus =
    readiness && readiness.electronStatus !== undefined
      ? `Electron status: ${readiness.electronStatus}`
      : "";
  return [statusMsg, electronStatus].filter(Boolean).join("，") || "未知状态";
}

module.exports = {
  getPrinterReadiness,
  isElectronStatusReady,
  isWin32StatusReady,
  formatPrinterStatus,
};
