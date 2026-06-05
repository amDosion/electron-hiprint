"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const originalSpawn = childProcess.spawn;

function stripOuterQuotes(value) {
  const text = String(value || "");
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

function isCmdExecutable(command) {
  const commandName = path.basename(String(command || "")).toLowerCase();
  return commandName === "cmd.exe" || commandName === "cmd";
}

function getNpmCliPath() {
  const candidates = [
    process.env.npm_execpath,
    process.env.NPM_CLI_JS,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ].filter(Boolean);
  return candidates.find((candidate) => {
    return path.extname(candidate).toLowerCase() === ".js" && fs.existsSync(candidate);
  });
}

function getAppBuilderCollectorArgs(command, args, options) {
  if (process.platform !== "win32" || !isCmdExecutable(command)) return null;
  if (!Array.isArray(args) || !options || options.shell !== true) return null;
  if (!options.env || options.env.COREPACK_ENABLE_STRICT !== "0") return null;

  const cIndex = args.findIndex((arg) => String(arg).toLowerCase() === "/c");
  if (cIndex < 0 || cIndex + 2 >= args.length) return null;

  const batPath = stripOuterQuotes(args[cIndex + 1]);
  if (path.extname(batPath).toLowerCase() !== ".bat") return null;
  if (!fs.existsSync(batPath)) return null;

  const npmArgs = args.slice(cIndex + 2);
  const firstArg = String(npmArgs[0] || "").toLowerCase();
  if (firstArg !== "list" && firstArg !== "config") return null;

  const npmCli = getNpmCliPath();
  return npmCli ? [npmCli, ...npmArgs] : null;
}

childProcess.spawn = function patchedSpawn(command, args, options) {
  const npmCollectorArgs = getAppBuilderCollectorArgs(command, args, options);
  if (npmCollectorArgs) {
    return originalSpawn.call(childProcess, process.execPath, npmCollectorArgs, {
      ...options,
      shell: false,
    });
  }
  return originalSpawn.apply(childProcess, arguments);
};

require("electron-builder/out/cli/cli");
