"use strict";

const {
  normalizeHost,
  isBlockedIPv4,
  isBlockedIPv6,
  getIppTargetError,
  getHttpUrlTargetError,
} = require("../../network-target-guard");

const checks = [];

function expect(name, ok, details) {
  checks.push({ name, ok: Boolean(ok), details });
}

function errorMessage(error) {
  return error ? error.message : "";
}

expect("normalizes-bracketed-ipv6", normalizeHost("[::1]") === "::1");
expect("blocks-localhost-ipp", /本机/.test(errorMessage(getIppTargetError("ipp://localhost/printers/a"))));
expect("blocks-private-ipv4-ipp", /IPv4/.test(errorMessage(getIppTargetError("ipp://192.168.1.10/printers/a"))));
expect("blocks-private-ipv6-ipp", /IPv6/.test(errorMessage(getIppTargetError("ipps://[fd00::1]/printers/a"))));
expect("blocks-invalid-ipp-protocol", /协议/.test(errorMessage(getIppTargetError("file:///tmp/a"))));
expect("allows-public-ipp-host", getIppTargetError("ipp://printer.example.com/printers/a") === null);
expect(
  "allows-configured-private-ipp-host",
  getIppTargetError("ipp://192.168.1.10/printers/a", ["192.168.1.10"]) === null,
);
expect(
  "allows-wildcard-ipp-host",
  getIppTargetError("ipp://localhost/printers/a", ["*"]) === null,
);

expect("blocks-localhost-http-download", /本机/.test(errorMessage(getHttpUrlTargetError("http://localhost/a.pdf"))));
expect("blocks-private-http-download", /IPv4/.test(errorMessage(getHttpUrlTargetError("https://10.0.0.5/a.pdf"))));
expect("blocks-non-http-download", /http\/https/.test(errorMessage(getHttpUrlTargetError("ftp://example.com/a.pdf"))));
expect("allows-public-http-download", getHttpUrlTargetError("https://example.com/a.pdf") === null);

expect("ipv4-loopback-blocked", isBlockedIPv4("127.0.0.1") === true);
expect("ipv4-public-allowed", isBlockedIPv4("8.8.8.8") === false);
expect("ipv6-loopback-blocked", isBlockedIPv6("::1") === true);
expect("ipv6-public-allowed", isBlockedIPv6("2001:4860:4860::8888") === false);

const failures = checks.filter((check) => !check.ok);
console.log(
  JSON.stringify(
    {
      failed: failures.length > 0,
      passed: checks.length - failures.length,
      failures,
    },
    null,
    2,
  ),
);

if (failures.length > 0) {
  process.exitCode = 1;
}
