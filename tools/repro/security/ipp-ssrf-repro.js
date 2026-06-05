"use strict";

const http = require("http");
const { io } = require("socket.io-client");

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

const host = getArg("--host", "127.0.0.1");
const port = Number(getArg("--port", "17521"));
const timeoutMs = Number(getArg("--timeout-ms", "5000"));
const authToken = getArg("--token", "");

function socketUrl() {
  return `http://${host}:${port}`;
}

function listenForOutboundProbe() {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
      });
      res.writeHead(200, { "content-type": "application/ipp" });
      res.end(Buffer.from([0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x03]));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        requests,
        targetUrl: `http://127.0.0.1:${address.port}/ipp-ssrf-probe`,
      });
    });
  });
}

function emitIppRequest(targetUrl) {
  return new Promise((resolve) => {
    const socket = io(socketUrl(), {
      transports: ["websocket"],
      timeout: timeoutMs,
      reconnection: false,
      auth: authToken ? { token: authToken } : {},
    });
    const timer = setTimeout(() => {
      socket.close();
      resolve({ emitted: false, error: "timeout" });
    }, timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      socket.emit("ippRequest", {
        url: targetUrl,
        data: {
          operation: "Get-Printer-Attributes",
          "operation-attributes-tag": {
            "attributes-charset": "utf-8",
            "attributes-natural-language": "en",
            "printer-uri": targetUrl,
          },
        },
      });
      resolve({ emitted: true, socketId: socket.id, close: () => socket.close() });
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ emitted: false, error: error.message, data: error.data });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

(async () => {
  const probe = await listenForOutboundProbe();
  const emitted = await emitIppRequest(probe.targetUrl);
  await wait(timeoutMs);
  if (emitted.close) emitted.close();
  probe.server.close();

  const riskObserved = probe.requests.length > 0;
  console.log(
    JSON.stringify(
      {
        target: socketUrl(),
        ssrfProbeUrl: probe.targetUrl,
        emitted,
        outboundRequests: probe.requests,
        risks: riskObserved
          ? [
              {
                id: "SEC-IPP-SSRF",
                detail: "Peer-controlled ippRequest URL caused the app to call a local HTTP listener.",
              },
            ]
          : [],
      },
      null,
      2,
    ),
  );

  if (!emitted.emitted && /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|timeout/i.test(emitted.error || "")) {
    process.exitCode = 2;
    return;
  }
  if (riskObserved) {
    process.exitCode = 1;
  }
})();
