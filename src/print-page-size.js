"use strict";

const MICRONS_PER_INCH = 25400;
const CSS_PIXELS_PER_INCH = 96;
const MICRONS_PER_HUNDREDTH_INCH = 254;
const PAPER_SIZE_MATCH_TOLERANCE = 2;
const MIN_PAGE_SIDE_MICRONS = 1000;

function isFinitePositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function normalizePageSize(pageSize) {
  if (typeof pageSize === "string") {
    const value = pageSize.trim();
    return value ? value : undefined;
  }

  if (!pageSize || typeof pageSize !== "object") return undefined;

  const width = Number(pageSize.width);
  const height = Number(pageSize.height);
  if (
    !isFinitePositiveNumber(width) ||
    !isFinitePositiveNumber(height) ||
    width < MIN_PAGE_SIDE_MICRONS ||
    height < MIN_PAGE_SIDE_MICRONS
  ) {
    return undefined;
  }

  return {
    width: Math.round(width),
    height: Math.round(height),
  };
}

function cssPixelsToMicrons(value) {
  const numeric = Number(value);
  if (!isFinitePositiveNumber(numeric)) return undefined;
  return Math.round((numeric * MICRONS_PER_INCH) / CSS_PIXELS_PER_INCH);
}

function inferPageSizeFromPaperRect(rect) {
  if (!rect || typeof rect !== "object") return undefined;
  const width = cssPixelsToMicrons(rect.widthPx ?? rect.width);
  const height = cssPixelsToMicrons(rect.heightPx ?? rect.height);
  if (
    !isFinitePositiveNumber(width) ||
    !isFinitePositiveNumber(height) ||
    width < MIN_PAGE_SIDE_MICRONS ||
    height < MIN_PAGE_SIDE_MICRONS
  ) {
    return undefined;
  }
  return { width, height };
}

async function inferPageSizeFromWebContents(webContents) {
  if (!webContents || webContents.isDestroyed?.()) return undefined;
  try {
    const rect = await webContents.executeJavaScript(
      `(() => {
        const paper = document.querySelector(".hiprint-printPaper");
        if (!paper) return null;
        const rect = paper.getBoundingClientRect();
        return { widthPx: rect.width, heightPx: rect.height };
      })()`,
      true,
    );
    return inferPageSizeFromPaperRect(rect);
  } catch (error) {
    console.log(
      `infer print page size failed: ${
        error && error.message ? error.message : error
      }`,
    );
    return undefined;
  }
}

async function resolvePrintPageSize(webContents, data) {
  const explicit = normalizePageSize(data && data.pageSize);
  if (explicit) return explicit;
  return inferPageSizeFromWebContents(webContents);
}

function withResolvedPageSize(data, pageSize) {
  return pageSize ? Object.assign({}, data, { pageSize }) : data;
}

function pageSizeToHundredthInches(pageSize) {
  const normalized = normalizePageSize(pageSize);
  if (!normalized || typeof normalized === "string") return undefined;
  return {
    width: Math.round(normalized.width / MICRONS_PER_HUNDREDTH_INCH),
    height: Math.round(normalized.height / MICRONS_PER_HUNDREDTH_INCH),
  };
}

function getPaperSizes(paperSizesInfo) {
  if (!paperSizesInfo) return [];
  if (Array.isArray(paperSizesInfo)) {
    if (paperSizesInfo.some((item) => Array.isArray(item && item.PaperSizes))) {
      return paperSizesInfo.flatMap((item) =>
        Array.isArray(item && item.PaperSizes) ? item.PaperSizes : [],
      );
    }
    return paperSizesInfo;
  }
  return Array.isArray(paperSizesInfo.PaperSizes)
    ? paperSizesInfo.PaperSizes
    : [];
}

function getPaperScore(paper, target, swapped = false) {
  const width = Number(paper && paper.Width);
  const height = Number(paper && paper.Height);
  if (!isFinitePositiveNumber(width) || !isFinitePositiveNumber(height)) {
    return Number.POSITIVE_INFINITY;
  }
  const targetWidth = swapped ? target.height : target.width;
  const targetHeight = swapped ? target.width : target.height;
  return Math.max(Math.abs(width - targetWidth), Math.abs(height - targetHeight));
}

function findPaperNameForPageSize(paperSizesInfo, pageSize) {
  const target = pageSizeToHundredthInches(pageSize);
  if (!target) return undefined;

  let best;
  for (const paper of getPaperSizes(paperSizesInfo)) {
    if (!paper || typeof paper.PaperName !== "string") continue;
    const exactScore = getPaperScore(paper, target, false);
    const swappedScore = getPaperScore(paper, target, true);
    const score = Math.min(exactScore, swappedScore);
    const swapped = swappedScore < exactScore;
    if (!best || score < best.score || (score === best.score && !swapped)) {
      best = { paper, score, swapped };
    }
  }

  return best && best.score <= PAPER_SIZE_MATCH_TOLERANCE
    ? best.paper.PaperName
    : undefined;
}

function resolvePdfPaperSizeName({
  data,
  printer,
  getPaperSizeInfoAll,
  platform = process.platform,
}) {
  if (data && typeof data.paperName === "string" && data.paperName.trim()) {
    return data.paperName.trim();
  }
  if (data && typeof data.paperSize === "string" && data.paperSize.trim()) {
    return data.paperSize.trim();
  }
  if (platform !== "win32" || typeof getPaperSizeInfoAll !== "function") {
    return undefined;
  }

  try {
    const printers = getPaperSizeInfoAll();
    const paperSizesInfo = Array.isArray(printers)
      ? printers.find((item) => item && item.PrinterName === printer)
      : undefined;
    return findPaperNameForPageSize(paperSizesInfo, data && data.pageSize);
  } catch (error) {
    console.log(
      `resolve pdf paper size failed: ${
        error && error.message ? error.message : error
      }`,
    );
    return undefined;
  }
}

module.exports = {
  cssPixelsToMicrons,
  findPaperNameForPageSize,
  inferPageSizeFromPaperRect,
  normalizePageSize,
  resolvePdfPaperSizeName,
  resolvePrintPageSize,
  withResolvedPageSize,
};
