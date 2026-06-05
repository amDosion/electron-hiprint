# HIPRINT-BUILD-WARNING-GITHUB-EXE: Warning-Free Build And GitHub Multi-Platform Installer Artifacts

## Context

The local Windows package build emits Node `DEP0190` after `npm run build-w-64`. Trace output shows the warning is emitted by `app-builder-lib`'s node module collector when Electron Builder runs `child_process.spawn(command, args, { shell: true })` on Node 24. Running `tools/rename` directly does not emit the warning.

The repository already has a tag-based release workflow that builds multi-platform artifacts, but day-to-day installer builds should also be available from GitHub Actions artifacts so local machines are not the packaging delivery path.

## Reproduction Script

```powershell
node tools/repro/build/build-pipeline-check.js
```

Current baseline should report:

- `BUILD-SCRIPTS-STILL-SHELL-CHAIN-ELECTRON-BUILDER`
- `BUILD-WRAPPER-MISSING`
- `ELECTRON-BUILDER-RUNNER-MISSING`
- `GITHUB-INSTALLER-WORKFLOW-MISSING`
- `GITHUB-INSTALLER-ARTIFACTS-MISSING`

## Goal

Remove warning-prone Electron packaging entry points and add a GitHub Actions workflow that builds Windows, macOS, Linux, and Kylin installer artifacts.

## Scope

- Package build scripts.
- Build orchestration helper.
- Electron Builder runner for the Node 24 `app-builder-lib` collector warning.
- GitHub Actions workflow for multi-platform installer artifacts.
- Regression coverage for warning-prone build script shape.

## Acceptance Criteria

- Build scripts call a Node wrapper instead of shell-chaining `npm run sync-plugin && electron-builder && node tools/rename`.
- The wrapper runs each step with explicit argv arrays and `shell: false`.
- The Electron Builder runner routes the `app-builder-lib` npm collector through `npm-cli.js` without warning suppression.
- Local `npm run build-w-64` does not emit `DEP0190`.
- GitHub Actions has a manual and branch-triggered multi-platform installer workflow.
- The workflow builds `win_x64`, `win_x32`, `mac_arm64`, `mac_x64`, `mac_universal`, `linux_64`, `linux_arm64`, and `Kylin_64`.
- The workflow verifies and uploads Windows `.exe` plus `.exe.blockmap`, macOS `.dmg`, and Linux/Kylin `.tar.xz` plus `.deb` artifacts.
- Existing tag-based Release workflow still builds through package scripts.
- The tag-based Release workflow uses GitHub glob-compatible tag patterns and publishes the same multi-platform artifacts.
- Local `npm run build-w-64` is retained as verification only; the generated install packages should be taken from GitHub Actions artifacts or Releases.

## Verification

```powershell
node tools/repro/build/build-pipeline-check.js
node --check tools/build-package.js tools/run-electron-builder.js tools/repro/build/build-pipeline-check.js
npm run build-w-64
```
