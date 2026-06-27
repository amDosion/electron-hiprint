"use strict";

const assert = require("assert");
const {
  getPrinterReadiness,
  isElectronStatusReady,
  isWin32StatusReady,
} = require("../../../src/printer-status");
const {
  resolvePrinterReadiness,
} = require("../../../src/printer-readiness-resolver");

const printers = [
  { name: "Ready Printer", isDefault: true, status: 3 },
  { name: "Unknown Printer", isDefault: false, status: 3 },
  { name: "Busy Printer", isDefault: false, status: 512 },
];

assert.strictEqual(isWin32StatusReady("准备就绪（Ready）"), true);
assert.strictEqual(isWin32StatusReady("未知状态（Unknown Status）"), false);
assert.strictEqual(isElectronStatusReady("linux", 3), true);
assert.strictEqual(isElectronStatusReady("linux", 4), false);

assert.deepStrictEqual(
  getPrinterReadiness({
    platform: "win32",
    printers,
    printerName: "Ready Printer",
    getStatusByName: () => ({ StatusMsg: "准备就绪（Ready）" }),
  }).ready,
  true,
);

assert.deepStrictEqual(
  getPrinterReadiness({
    platform: "win32",
    printers,
    printerName: "Unknown Printer",
    getStatusByName: () => ({ StatusMsg: "未知状态（Unknown Status）" }),
  }).ready,
  false,
);

assert.deepStrictEqual(
  getPrinterReadiness({
    platform: "win32",
    printers,
    printerName: "Busy Printer",
    getStatusByName: () => ({ StatusMsg: "忙（Busy）" }),
  }).ready,
  true,
);

assert.deepStrictEqual(
  getPrinterReadiness({
    platform: "win32",
    printers,
    printerName: "Missing Printer",
    getStatusByName: () => ({ StatusMsg: "未找到打印机" }),
  }).ready,
  false,
);

const fakeWebContents = {
  getPrintersAsync: async () => printers,
};
const fakeStore = {
  get: (key) => (key === "defaultPrinter" ? "Ready Printer" : ""),
};

(async () => {
  const explicit = await resolvePrinterReadiness({
    webContents: fakeWebContents,
    data: { printer: "Busy Printer" },
    store: fakeStore,
    platform: "win32",
    getStatusByName: () => ({ StatusMsg: "忙（Busy）" }),
  });
  assert.strictEqual(explicit.deviceName, "Busy Printer");
  assert.strictEqual(explicit.readiness.ready, true);

  const fallback = await resolvePrinterReadiness({
    webContents: fakeWebContents,
    data: {},
    store: fakeStore,
    platform: "win32",
    getStatusByName: () => ({ StatusMsg: "准备就绪（Ready）" }),
  });
  assert.strictEqual(fallback.deviceName, "Ready Printer");
  assert.strictEqual(fallback.readiness.ready, true);

  console.log(
    "PRINTER_STATUS_RESULT " +
      JSON.stringify({ failed: false, cases: 10 }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
