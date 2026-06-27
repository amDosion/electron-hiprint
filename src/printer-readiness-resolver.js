"use strict";

const { getPrinterReadiness } = require("./printer-status");

async function resolvePrinterReadiness({
  webContents,
  data,
  store,
  getStatusByName,
  platform = process.platform,
}) {
  const printers = await webContents.getPrintersAsync();
  const requestedPrinter = (data && data.printer) || store.get("defaultPrinter", "");
  const readiness = getPrinterReadiness({
    platform,
    printers,
    printerName: requestedPrinter,
    getStatusByName,
  });
  const deviceName = readiness.printerName || requestedPrinter;
  return { printers, readiness, deviceName };
}

module.exports = { resolvePrinterReadiness };
