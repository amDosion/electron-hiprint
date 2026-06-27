"use strict";

const net = require("net");

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "");
}

function normalizeAllowedHosts(allowedHosts) {
  return Array.isArray(allowedHosts)
    ? allowedHosts.map(normalizeHost).filter(Boolean)
    : [];
}

function isBlockedIPv4(hostname) {
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isBlockedIPv6(hostname) {
  const normalized = normalizeHost(hostname);
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

function createIppTargetError(message) {
  const error = new Error(message);
  error.name = "InvalidIppTarget";
  return error;
}

function getIppTargetError(rawUrl, allowedHosts = []) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return createIppTargetError("IPP URL 格式无效");
  }

  if (!["http:", "https:", "ipp:", "ipps:"].includes(parsed.protocol)) {
    return createIppTargetError("IPP URL 协议不被允许");
  }

  const hostname = normalizeHost(parsed.hostname);
  const normalizedAllowedHosts = normalizeAllowedHosts(allowedHosts);
  if (
    normalizedAllowedHosts.includes("*") ||
    normalizedAllowedHosts.includes(hostname)
  ) {
    return null;
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return createIppTargetError("IPP URL 不能指向本机地址");
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isBlockedIPv4(hostname)) {
    return createIppTargetError("IPP URL 不能指向内网或保留 IPv4 地址");
  }
  if (ipVersion === 6 && isBlockedIPv6(hostname)) {
    return createIppTargetError("IPP URL 不能指向内网或保留 IPv6 地址");
  }

  return null;
}

/**
 * @description: 校验对端可控的 http(s) 下载地址，拦截 SSRF（如 url_pdf 打印类型）。
 *   仅放行 http/https，拒绝 localhost 与内网/保留 IPv4/IPv6 字面量地址。
 *   注意：此处只校验 URL 中的字面量主机；域名解析到内网的 DNS 重绑定由调用方
 *   在连接前对解析后的 IP 再做一次 isBlockedIPv4/isBlockedIPv6 校验。
 * @param {string} rawUrl 待校验的 URL
 * @return {Error|null} 不合法时返回 Error，合法返回 null
 */
function getHttpUrlTargetError(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return new Error("下载地址格式无效");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return new Error("仅允许 http/https 协议");
  }
  const hostname = normalizeHost(parsed.hostname);
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost")
  ) {
    return new Error("下载地址不能指向本机地址");
  }
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isBlockedIPv4(hostname)) {
    return new Error("下载地址不能指向内网或保留 IPv4 地址");
  }
  if (ipVersion === 6 && isBlockedIPv6(hostname)) {
    return new Error("下载地址不能指向内网或保留 IPv6 地址");
  }
  return null;
}

module.exports = {
  normalizeHost,
  isBlockedIPv4,
  isBlockedIPv6,
  getIppTargetError,
  getHttpUrlTargetError,
};
