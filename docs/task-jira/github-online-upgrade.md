# HIPRINT-UPDATER: Tray Menu Runs Verified GitHub Release Upgrade

## Context

Online upgrade is an application-level action, not a persisted client setting. It should sit with the program tray actions such as "显示主窗口", "设置", "软件日志", "打印记录", "关于", and "退出".

The previous implementation exposed `客户端在线升级` inside the advanced settings tab. That made the update action look like a configurable option and coupled update progress to the settings renderer IPC.

Reference behavior:

- GitHub Releases REST API returns release assets with `browser_download_url`, `size`, and `digest`.
- The client should verify a matching Windows NSIS installer before launching it.
- The entry point should be the tray context menu item `在线升级`.

## Reproduction Script

```powershell
node tools/repro/updater/github-online-upgrade-check.js
```

The regression script now checks that:

- GitHub latest release lookup still uses `amDosion/electron-hiprint`.
- Release asset SHA256 digest verification is required.
- The verified installer is launched without `/S` so the user can see the installer UI after confirming the upgrade.
- The settings page and settings preload no longer expose online-upgrade IPC or buttons.
- The tray context menu exposes `在线升级` and calls the program-level runner.

## Goal

Move online upgrade out of advanced settings and into the tray right-click menu while preserving the verified GitHub Release upgrade path.

## Scope

- Program-level online upgrade runner.
- Tray menu entry and busy-state relabeling.
- Removal of settings-page upgrade button and settings IPC channels.
- Static/helper regression coverage.

## Acceptance Criteria

- The tray right-click menu contains `在线升级` at the same level as display/settings/logs/records/about/exit.
- While an upgrade is in progress, the tray menu shows `升级处理中...` and prevents duplicate triggers.
- The settings window does not show `客户端在线升级` or `检查并在线升级`.
- The settings preload does not allow `checkOnlineUpgrade` or `onlineUpdateStatus`.
- Upgrade checks the latest GitHub Release for `amDosion/electron-hiprint`.
- The updater chooses the Windows x64 NSIS installer asset for the current package.
- The updater rejects unsupported platforms, missing digest, non-HTTPS URLs, and non-GitHub download URLs.
- The updater downloads to a temp file and verifies the SHA256 digest before running the installer.
- The installer is launched with visible installer UI after user confirmation.
- The installer is launched by a detached helper only after the current app process exits, avoiding upgrade/restart races with the running app.
- Online upgrade writes check/download/verify/install scheduling/error stages into the software log.
- The upgrade path does not introduce a new runtime dependency.

## Implementation Progress

2026-06-05 execution:

- Added `tools/repro/updater/github-online-upgrade-check.js` before production edits; original baseline reported missing updater behavior.
- Added `src/online-update.js` with GitHub latest release lookup, semantic version comparison, Windows installer asset selection, trusted URL checks, and SHA256 digest verification.
- Added `src/online-upgrade-runner.js` as the program-level update flow.
- Added the tray context menu entry `在线升级`; it relabels to `升级处理中...` while busy.
- Removed the advanced-settings `客户端在线升级` button.
- Removed settings-window online-upgrade IPC and status channels.

## Verification

```powershell
node tools/repro/updater/github-online-upgrade-check.js
node --check main.js src/online-update.js src/online-upgrade-runner.js src/set.js src/preload/set.js tools/repro/updater/github-online-upgrade-check.js
npm run build-w-64
```

2026-06-13 restart-race hardening:

- Added `src/deferred-installer-launcher.js` so the Windows installer is scheduled from a detached PowerShell helper that waits for the current process to exit before running the NSIS installer.
- The online upgrade runner now logs check/download/verify/install scheduling/error stages to the software log.
- The regression script now asserts the deferred launch order, safe path quoting, visible installer UI, temp launcher logging, and `/KEEP_APP_DATA` upgrade argument.

2026-06-13 visible-installer follow-up:

- Removed `--updated` from the main installer launch arguments. That flag belongs to electron-builder's internal upgrade/uninstall path, while the user-confirmed online-upgrade path should open the normal visible installer UI.
- The deferred launcher now writes a temporary PowerShell script and runs it with `powershell.exe -File`, avoiding nested command-line quoting issues.
- The helper logs wait/launch/failure stages to `%TEMP%\hiprint-online-upgrade-launcher.log` so hidden helper failures are diagnosable.
- The helper remains hidden, but the NSIS installer is started with `Start-Process -WindowStyle Normal -PassThru`.
- The regression script also asserts that `installer.nsh` preserves AppData on both electron-builder upgrade and explicit `/KEEP_APP_DATA` paths.
- The app now waits for a `ready <launcher id>` marker in the launcher log before quitting, and avoids Node `detached: true`; Electron starts only a short bootstrap PowerShell, and that bootstrap starts the durable helper with PowerShell `Start-Process` so it survives the app exit and can open the visible installer.
