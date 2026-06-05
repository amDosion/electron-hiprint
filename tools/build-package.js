"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

const TARGETS = {
  "build-w": {
    builderArgs: ["-w", "nsis:ia32"],
    tag: "win_x32",
  },
  "build-w-64": {
    builderArgs: ["-w", "nsis:x64"],
    tag: "win_x64",
  },
  "build-m": {
    builderArgs: ["-m", "--x64"],
    tag: "mac_x64",
  },
  "build-m-arm64": {
    builderArgs: ["-m", "--arm64"],
    tag: "mac_arm64",
  },
  "build-m-universal": {
    builderArgs: ["-m", "--universal"],
    tag: "mac_universal",
  },
  "build-l": {
    builderArgs: ["-l"],
    tag: "linux_64",
  },
  "build-l-arm64": {
    builderArgs: ["-l", "--arm64"],
    tag: "linux_arm64",
  },
  "build-kylin": {
    builderArgs: [],
    tag: "Kylin_64",
  },
};

const BUILD_ALL_TARGETS = [
  "build-w",
  "build-w-64",
  "build-m",
  "build-m-arm64",
  "build-m-universal",
  "build-l",
  "build-l-arm64",
];

function runNodeScript(scriptPath, args = []) {
  run(process.execPath, [scriptPath, ...args]);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function build(targetName) {
  const target = TARGETS[targetName];
  if (!target) {
    throw new Error(`Unknown build target: ${targetName}`);
  }

  runNodeScript(path.join(repoRoot, "tools", "sync-builtin-plugin.js"));
  runNodeScript(
    path.join(repoRoot, "tools", "run-electron-builder.js"),
    target.builderArgs,
  );
  runNodeScript(path.join(repoRoot, "tools", "rename"), ["--tag", target.tag]);
}

function main() {
  const targetName = process.argv[2];
  if (!targetName) {
    throw new Error("Usage: node tools/build-package.js <build-target>");
  }
  if (targetName === "build-all") {
    BUILD_ALL_TARGETS.forEach(build);
    return;
  }
  build(targetName);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
