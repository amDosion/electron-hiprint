"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  getExportCapability,
  handleFileExportTask,
} = require("../../file-export");

function createClient() {
  const events = [];
  return {
    events,
    emit(name, payload) {
      events.push({ name, payload });
    },
  };
}

function payload(text) {
  return Buffer.from(text, "utf8").toString("base64");
}

function sha256(text) {
  return crypto.createHash("sha256").update(Buffer.from(text)).digest("hex");
}

function runExport(config, task) {
  const client = createClient();
  handleFileExportTask(client, task, config);
  return client.events;
}

function expect(name, ok, details) {
  return { name, ok: Boolean(ok), details };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hiprint-file-export-"));
const config = {
  enabled: true,
  path: root,
  displayName: "Shared",
  maxBytes: 1024,
  allowedExtensions: [".pdf", "txt", ".json"],
  conflictPolicy: "rename",
};
const checks = [];

try {
  const successEvents = runExport(config, {
    taskId: "task-ok",
    replyId: "reply-ok",
    mode: "binary",
    fileName: "report.pdf",
    payload: payload("hello"),
    size: 5,
    sha256: sha256("hello"),
  });
  const success = successEvents.find((event) => event.name === "file.export.success");
  checks.push(
    expect(
      "writes-success-file",
      success &&
        success.payload.taskId === "task-ok" &&
        success.payload.replyId === "reply-ok" &&
        success.payload.fileName === "report.pdf" &&
        success.payload.displayPath === "Shared/report.pdf" &&
        success.payload.bytes === 5 &&
        fs.readFileSync(path.join(root, "report.pdf"), "utf8") === "hello",
      success,
    ),
  );

  const traversalEvents = runExport(config, {
    mode: "binary",
    fileName: "../evil.pdf",
    payload: payload("bad"),
  });
  checks.push(
    expect(
      "rejects-path-fragments",
      traversalEvents.some(
        (event) =>
          event.name === "file.export.error" &&
          event.payload.code === "FILE_NAME_INVALID",
      ) && !fs.existsSync(path.join(path.dirname(root), "evil.pdf")),
      traversalEvents,
    ),
  );

  const blockedExtEvents = runExport(config, {
    mode: "binary",
    fileName: "run.exe",
    payload: payload("bad"),
  });
  checks.push(
    expect(
      "rejects-blocked-extension",
      blockedExtEvents.some(
        (event) =>
          event.name === "file.export.error" &&
          event.payload.code === "FILE_EXTENSION_BLOCKED",
      ),
      blockedExtEvents,
    ),
  );

  const checksumEvents = runExport(config, {
    mode: "binary",
    fileName: "checksum.pdf",
    payload: payload("body"),
    sha256: "0".repeat(64),
  });
  checks.push(
    expect(
      "rejects-checksum-mismatch",
      checksumEvents.some(
        (event) =>
          event.name === "file.export.error" &&
          event.payload.code === "CHECKSUM_MISMATCH",
      ),
      checksumEvents,
    ),
  );

  fs.writeFileSync(path.join(root, "dup.pdf"), "old");
  const renameEvents = runExport(config, {
    mode: "binary",
    fileName: "dup.pdf",
    payload: payload("new"),
  });
  const renameSuccess = renameEvents.find(
    (event) => event.name === "file.export.success",
  );
  checks.push(
    expect(
      "renames-conflict",
      renameSuccess &&
        renameSuccess.payload.fileName === "dup (1).pdf" &&
        fs.readFileSync(path.join(root, "dup.pdf"), "utf8") === "old" &&
        fs.readFileSync(path.join(root, "dup (1).pdf"), "utf8") === "new",
      renameEvents,
    ),
  );

  const disabledEvents = runExport({ ...config, enabled: false }, {
    mode: "binary",
    fileName: "off.pdf",
    payload: payload("off"),
  });
  checks.push(
    expect(
      "rejects-disabled-export",
      disabledEvents.some(
        (event) =>
          event.name === "file.export.error" &&
          event.payload.code === "FILE_EXPORT_DISABLED",
      ),
      disabledEvents,
    ),
  );

  const capability = getExportCapability({ ...config, path: root });
  checks.push(
    expect(
      "capability-hides-raw-path",
      capability.enabled === true &&
        capability.displayName === "Shared" &&
        !Object.prototype.hasOwnProperty.call(capability, "path") &&
        capability.allowedExtensions.includes(".txt"),
      capability,
    ),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

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
