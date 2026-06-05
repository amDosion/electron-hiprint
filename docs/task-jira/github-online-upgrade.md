# HIPRINT-UPDATER: Settings Button Pulls Verified GitHub Release Upgrade

## Context

Users currently need a manually delivered installer to upgrade the client. The settings window should expose an online upgrade action that checks the latest GitHub Release, downloads the matching installer, verifies the release asset digest, and starts the upgrade installer.

Reference behavior:

- GitHub Releases REST API returns release assets with `browser_download_url`, `size`, and `digest`.
- Electron packaged apps can self-update from GitHub-hosted releases, but this project does not currently use an updater dependency.

Reproduction script:

```powershell
node tools/repro/updater/github-online-upgrade-check.js
```

Current baseline reports:

- `UPDATER-MODULE-MISSING`
- `UPDATER-GITHUB-LATEST-NOT-USED`
- `UPDATER-ASSET-DIGEST-NOT-VERIFIED`
- `UPDATER-INSTALLER-NOT-LAUNCHED`
- `UPDATER-IPC-NOT-EXPOSED`
- `UPDATER-SETTINGS-BUTTON-MISSING`

## Implementation Progress

2026-06-05 execution:

- Added `tools/repro/updater/github-online-upgrade-check.js` before production edits; baseline reported `observed: 6`.
- Added `src/online-update.js` with GitHub latest release lookup, semantic version comparison, Windows installer asset selection, trusted URL checks, and SHA256 digest verification.
- Added the settings-window IPC action `checkOnlineUpgrade` and status event `onlineUpdateStatus`.
- Added a `客户端在线升级` button to the advanced settings tab.
- The regression script now reports `observed: 0`.
- Verified the live GitHub latest release endpoint returns `1.0.19` with `hiprint_win_x64-1.0.19.exe` and a `sha256:` digest; local `1.0.20` correctly compares as not needing a downgrade.
- Rebuilt `out\hiprint_win_x64-1.0.20.exe` and replaced the local installation; `%APPDATA%\electron-hiprint\config.json` hash remained `CF1EC086719830C3C745DFE650E8695B23842DCC878EE5DDF99F39C9FDFF4346`.
- Verified the installed `app.asar` contains the online upgrade button, IPC whitelist, updater module, and silent installer launch path.

## Goal

Add a manual online upgrade button in the settings window that safely upgrades from GitHub Releases.

## Scope

- Settings UI button and busy state.
- Preload IPC allowlist for upgrade action and status events.
- Main-process GitHub Release lookup, installer asset selection, digest verification, and installer launch.
- Static/helper regression coverage.

## Acceptance Criteria

- The settings window has a visible online upgrade action.
- The renderer can only use explicit upgrade IPC channels exposed by preload.
- Upgrade checks the latest GitHub Release for `amDosion/electron-hiprint`.
- The updater chooses the Windows x64 NSIS installer asset for the current package.
- The updater rejects unsupported platforms, missing digest, non-HTTPS URLs, and non-GitHub download URLs.
- The updater downloads to a temp file and verifies the SHA256 digest before running the installer.
- The installer is launched with the silent upgrade argument after user confirmation.
- The upgrade path does not introduce a new runtime dependency.

## Verification

```powershell
node tools/repro/updater/github-online-upgrade-check.js
node --check src/online-update.js src/set.js src/preload/set.js tools/repro/updater/github-online-upgrade-check.js
npm run build-w-64
```
