# HIPRINT-INSTALL: Upgrade Install Preserves Local Configuration

## Context

The existing NSIS include asks whether to delete `%APPDATA%\electron-hiprint` in `customUnInstall`.
Electron-builder invokes the previous uninstaller during upgrades with `/S /KEEP_APP_DATA --updated`, but the custom macro did not check those flags before showing the prompt or removing app data.

Reproduction script:

```powershell
node tools/repro/installer/package-upgrade-check.js
```

Current baseline reports:

- `NSIS-CONFIG-SEED-OVERWRITES-EXISTING`
- `NSIS-UPGRADE-UNINSTALL-PROMPTS-DATA-DELETE`
- `NSIS-SILENT-UNINSTALL-CAN-PROMPT-OR-DELETE-DATA`
- `NSIS-DELETE-APP-DATA-FLAG-NOT-HONORED`
- `NPM-LEGACY-MIRROR-CONFIG-WARNINGS`

## Implementation Progress

2026-06-05 execution:

- Added `tools/repro/installer/package-upgrade-check.js` before production edits.
- Updated `customInstall` so an installer-adjacent `config.json` seeds AppData only when the user config does not already exist.
- Updated `customUnInstall` so `--updated`, `/KEEP_APP_DATA`, and silent uninstall keep AppData unless `--delete-app-data` is explicit.
- Removed legacy `.npmrc` mirror keys that npm 11 reports as unknown project config.
- Bumped the app release version to `1.0.20` for an actual upgrade installer.
- Regression script now reports `observed: 0`.
- Built `out\hiprint_win_x64-1.0.20.exe` and used it to replace the local installation.
- The first transition from the previously installed uninstaller required a one-time config restore because that old uninstaller did not honor keep-data flags.
- A subsequent upgrade using the fixed installer preserved `%APPDATA%\electron-hiprint\config.json` byte-for-byte:
  `CF1EC086719830C3C745DFE650E8695B23842DCC878EE5DDF99F39C9FDFF4346` before and after install.

## Goal

Make installer upgrades preserve existing user configuration and remove npm mirror warnings that obscure build output.

## Scope

- `installer.nsh`
- `.npmrc`
- `package.json` / `package-lock.json` release version
- `tools/repro/installer/package-upgrade-check.js`

## Acceptance Criteria

- Upgrade uninstall path honors `--updated` and `/KEEP_APP_DATA` before any data deletion prompt.
- Silent uninstall keeps app data unless `--delete-app-data` is explicitly passed.
- Manual interactive uninstall can still ask whether to delete app data.
- Installer-side `config.json` seed does not overwrite an existing `%APPDATA%\electron-hiprint\config.json`.
- `.npmrc` no longer emits npm 11 unknown project config warnings.
- New release installer uses a bumped app version.
- Local installed app is replaced with the new installer and the existing `%APPDATA%\electron-hiprint\config.json` is preserved.

## Verification

```powershell
node tools/repro/installer/package-upgrade-check.js
npm ci
npm audit --json
npm run build-w-64
```

Local replacement verification:

```powershell
Get-FileHash "$env:APPDATA\electron-hiprint\config.json"
out\hiprint_win_x64-<version>.exe /S
Get-FileHash "$env:APPDATA\electron-hiprint\config.json"
```

Expected result: config hash is unchanged after upgrade install.
