"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..", "..");

function read(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function record(risks, id, ok, detail) {
  if (!ok) {
    risks.push({ id, detail });
  }
}

function main() {
  const risks = [];
  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json") || "{}");
  const scripts = packageJson.scripts || {};
  const buildWrapper = read("tools/build-package.js");
  const builderRunner = read("tools/run-electron-builder.js");
  const renameTool = read("tools/rename.js");
  const runtimeUtils = read("tools/utils.js");
  const installersWorkflow = read(".github/workflows/installers.yml");
  const releaseWorkflow = read(".github/workflows/release.yml");
  const ciWorkflow = read(".github/workflows/ci.yml");
  const autoTagWorkflow = read(".github/workflows/plugin-bump.yml");

  const directBuilderScripts = Object.entries(scripts).filter(
    ([name, value]) => {
      return (
        /^build-/.test(name) &&
        typeof value === "string" &&
        (/&&/.test(value) || /electron-builder/.test(value))
      );
    },
  );

  record(
    risks,
    "BUILD-SCRIPTS-STILL-SHELL-CHAIN-ELECTRON-BUILDER",
    directBuilderScripts.length === 0,
    `build scripts should call a Node wrapper instead of shell-chaining electron-builder; offenders: ${directBuilderScripts
      .map(([name]) => name)
      .join(", ")}`,
  );

  record(
    risks,
    "IPP-RUNTIME-DEPENDENCY-MISSING",
    Object.prototype.hasOwnProperty.call(
      packageJson.dependencies || {},
      "ipp",
    ) &&
      packageLock.packages &&
      packageLock.packages["node_modules/ipp"] &&
      runtimeUtils.includes('require("ipp")'),
    "tools/utils.js handles ippPrint/ippRequest at runtime, so ipp must remain a direct packaged dependency and be present in package-lock.json.",
  );

  record(
    risks,
    "BUILD-WRAPPER-MISSING",
    exists("tools/build-package.js") &&
      buildWrapper.includes("spawnSync") &&
      buildWrapper.includes("shell: false") &&
      buildWrapper.includes("run-electron-builder.js") &&
      buildWrapper.includes("build-renderer.js") &&
      buildWrapper.includes('"tools"') &&
      buildWrapper.includes('"rename"'),
    "tools/build-package.js should run build-renderer (bundles the ESM plugin into assets/), electron-builder, and rename through explicit argv arrays with shell disabled.",
  );

  record(
    risks,
    "ELECTRON-BUILDER-RUNNER-MISSING",
    exists("tools/run-electron-builder.js") &&
      builderRunner.includes('require("electron-builder/out/cli/cli")') &&
      builderRunner.includes("COREPACK_ENABLE_STRICT") &&
      builderRunner.includes("npm-cli.js") &&
      builderRunner.includes("shell: false") &&
      !builderRunner.includes("NODE_NO_WARNINGS"),
    "tools/run-electron-builder.js should route app-builder-lib npm collector calls through npm-cli.js without shell:true or warning suppression.",
  );

  record(
    risks,
    "GITHUB-INSTALLER-WORKFLOW-MISSING",
    exists(".github/workflows/installers.yml") &&
      !exists(".github/workflows/windows-installer.yml") &&
      installersWorkflow.includes("workflow_dispatch") &&
      !installersWorkflow.includes("windows-latest") &&
      installersWorkflow.includes("windows-2025-vs2026") &&
      installersWorkflow.includes("macos-15-intel") &&
      installersWorkflow.includes("macos-15") &&
      installersWorkflow.includes("ubuntu-latest") &&
      installersWorkflow.includes("build-w-64") &&
      installersWorkflow.includes("build-w") &&
      installersWorkflow.includes("build-m-arm64") &&
      installersWorkflow.includes("build-m") &&
      installersWorkflow.includes("build-m-universal") &&
      installersWorkflow.includes("build-l") &&
      installersWorkflow.includes("build-l-arm64") &&
      installersWorkflow.includes("build-kylin"),
    "GitHub Actions should provide a multi-platform installer artifact workflow with an explicit Windows runner label instead of a Windows-only workflow or floating windows-latest label.",
  );

  record(
    risks,
    "GITHUB-INSTALLER-ARTIFACTS-MISSING",
    installersWorkflow.includes("actions/upload-artifact") &&
      installersWorkflow.includes("Verify installer outputs") &&
      installersWorkflow.includes("out/hiprint_${{ matrix.artifact }}-*.exe") &&
      installersWorkflow.includes(
        "out/hiprint_${{ matrix.artifact }}-*.exe.blockmap",
      ) &&
      installersWorkflow.includes("out/hiprint_${{ matrix.artifact }}-*.dmg") &&
      installersWorkflow.includes(
        "out/hiprint_${{ matrix.artifact }}-*.tar.xz",
      ) &&
      installersWorkflow.includes("out/hiprint_${{ matrix.artifact }}-*.deb") &&
      renameTool.includes(".exe.blockmap"),
    "The installer workflow should verify and upload Windows, macOS, and Linux installer artifacts.",
  );

  record(
    risks,
    "BUILD-WORKFLOWS-UPGRADE-SMOKE-MISSING",
    exists("tools/repro/updater/installed-upgrade-smoke.ps1") &&
      installersWorkflow.includes("installed-upgrade-smoke.ps1") &&
      installersWorkflow.includes("Smoke online upgrade restart") &&
      installersWorkflow.includes("matrix.artifact == 'win_x64'") &&
      installersWorkflow.includes("GITHUB_TOKEN") &&
      releaseWorkflow.includes("installed-upgrade-smoke.ps1") &&
      releaseWorkflow.includes("验证在线升级安装后可重启") &&
      releaseWorkflow.includes("matrix.artifact == 'win_x64'") &&
      releaseWorkflow.includes("GITHUB_TOKEN"),
    "Windows x64 build workflows should install a previous release, upgrade with the built installer, and verify restart via the installed-upgrade smoke before publishing artifacts.",
  );

  record(
    risks,
    "TAG-RELEASE-WORKFLOW-NOT-USING-BUILD-SCRIPTS",
    releaseWorkflow.includes("npm run ${{ matrix.script }}") &&
      releaseWorkflow.includes('node-version: "24"') &&
      !releaseWorkflow.includes("windows-latest") &&
      releaseWorkflow.includes("windows-2025-vs2026") &&
      releaseWorkflow.includes("macos-15-intel") &&
      releaseWorkflow.includes("build-kylin") &&
      releaseWorkflow.includes("[0-9]*.[0-9]*.[0-9]*") &&
      !releaseWorkflow.includes("actions/download-artifact@v6") &&
      releaseWorkflow.includes("actions/download-artifact@v8") &&
      !releaseWorkflow.includes("softprops/action-gh-release@v2") &&
      releaseWorkflow.includes("softprops/action-gh-release@v3") &&
      releaseWorkflow.includes(
        "out/hiprint_${{ matrix.artifact }}-*.exe.blockmap",
      ),
    "The tag release workflow should use the same multi-platform build scripts, artifact checks, and Node 24-compatible release actions.",
  );

  record(
    risks,
    "AUTO-TAG-WORKFLOW-MISSING",
    exists(".github/workflows/plugin-bump.yml") &&
      autoTagWorkflow.includes("push:") &&
      autoTagWorkflow.includes("branches: [master, main]") &&
      autoTagWorkflow.includes("repository_dispatch") &&
      autoTagWorkflow.includes("secrets.RELEASE_PAT") &&
      autoTagWorkflow.includes(
        "startsWith(github.event.head_commit.message, 'chore(release): client ')",
      ) &&
      autoTagWorkflow.includes("npm version patch --no-git-tag-version") &&
      autoTagWorkflow.includes("--allow-same-version") &&
      autoTagWorkflow.includes('git push origin "${CLIENT_VERSION}"'),
    "The auto tag workflow should bump/tag valid branch pushes and plugin releases using RELEASE_PAT so tag pushes can trigger the release workflow.",
  );

  record(
    risks,
    "CI-UPGRADE-SMOKE-SYNTAX-MISSING",
    ciWorkflow.includes("installed-upgrade-smoke.ps1") &&
      ciWorkflow.includes("[scriptblock]::Create"),
    "CI syntax checks should parse the installed upgrade smoke PowerShell script.",
  );

  console.log(
    JSON.stringify(
      {
        repoRoot,
        observed: risks.length,
        risks,
      },
      null,
      2,
    ),
  );

  if (risks.length > 0) {
    process.exitCode = 1;
  }
}

main();
