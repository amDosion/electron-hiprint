"use strict";

const assert = require("assert");
const {
  cssPixelsToMicrons,
  findPaperNameForPageSize,
  inferPageSizeFromPaperRect,
  normalizePageSize,
  resolvePdfPaperSizeName,
  resolvePrintPageSize,
} = require("../../../src/print-page-size");

function pxForMm(mm) {
  return (mm * 96) / 25.4;
}

assert.deepStrictEqual(normalizePageSize({ width: 60000.4, height: 79999.6 }), {
  width: 60000,
  height: 80000,
});
assert.strictEqual(normalizePageSize(" A4 "), "A4");
assert.strictEqual(normalizePageSize({ width: 10, height: 10 }), undefined);

assert.strictEqual(cssPixelsToMicrons(pxForMm(60)), 60000);
assert.strictEqual(cssPixelsToMicrons(pxForMm(80)), 80000);

assert.deepStrictEqual(
  inferPageSizeFromPaperRect({
    widthPx: pxForMm(60),
    heightPx: pxForMm(80),
  }),
  { width: 60000, height: 80000 },
);

const paperSizesInfo = {
  PrinterName: "Bluetooth Label",
  PaperSizes: [
    {
      Height: 1100,
      Kind: 1,
      PaperName: "Letter",
      Width: 850,
    },
    {
      Height: 315,
      Kind: 256,
      PaperName: "60mm * 80mm",
      Width: 236,
    },
  ],
};

assert.strictEqual(
  findPaperNameForPageSize(paperSizesInfo, { width: 60000, height: 80000 }),
  "60mm * 80mm",
);
assert.strictEqual(
  findPaperNameForPageSize(paperSizesInfo, { width: 80000, height: 60000 }),
  "60mm * 80mm",
);
assert.strictEqual(
  findPaperNameForPageSize(paperSizesInfo, { width: 100000, height: 150000 }),
  undefined,
);

assert.strictEqual(
  resolvePdfPaperSizeName({
    data: { paperName: "Driver Custom" },
    printer: "Bluetooth Label",
    getPaperSizeInfoAll: () => [],
    platform: "win32",
  }),
  "Driver Custom",
);
assert.strictEqual(
  resolvePdfPaperSizeName({
    data: { paperSize: "Native Paper" },
    printer: "Bluetooth Label",
    getPaperSizeInfoAll: () => [],
    platform: "win32",
  }),
  "Native Paper",
);
assert.strictEqual(
  resolvePdfPaperSizeName({
    data: { pageSize: { width: 60000, height: 80000 } },
    printer: "Bluetooth Label",
    getPaperSizeInfoAll: () => [paperSizesInfo],
    platform: "win32",
  }),
  "60mm * 80mm",
);

(async () => {
  let domFallbackCalled = false;
  const fakeWebContents = {
    executeJavaScript: async () => {
      domFallbackCalled = true;
      return { widthPx: pxForMm(60), heightPx: pxForMm(80) };
    },
  };

  assert.deepStrictEqual(
    await resolvePrintPageSize(fakeWebContents, {
      pageSize: { width: 70000, height: 90000 },
    }),
    { width: 70000, height: 90000 },
  );
  assert.strictEqual(domFallbackCalled, false);
  assert.deepStrictEqual(await resolvePrintPageSize(fakeWebContents, {}), {
    width: 60000,
    height: 80000,
  });
  assert.strictEqual(domFallbackCalled, true);

  console.log(
    "PRINT_PAGE_SIZE_RESULT " +
      JSON.stringify({
        failed: false,
        cases: 13,
      }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
