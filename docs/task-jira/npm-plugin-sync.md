# HIPRINT-PLUGIN-NPM-SYNC: Built-In Renderer Plugin Tracks @amdosion/vue3-print

## Context

The Electron client used to expose an "internal renderer plugin" version picker in the EXE settings UI. That made users choose or download a client implementation detail manually, and it still pointed at the old `vue-plugin-hiprint` package path.

The current internal renderer package is `@amdosion/vue3-print`. On 2026-06-05, `@amdosion/vue3-print@1.0.11` was published with the Electron browser/global artifact required by the client:

- `dist/vue-plugin-hiprint.js`
- `dist/vue3-print.css`
- `dist/print-lock.css`

The client cache contract remains:

- `<version>_vue-plugin-hiprint.js`
- `<version>_style.css`
- `<version>_print-lock.css`

## Reproduction Script

```powershell
node tools/repro/plugin/npm-package-sync-check.js
```

The original baseline reported old-package usage, manual UI selection, missing dist mapping, weak diagnostics, and the fixed `1.0.4` default.

## Goal

Make the built-in renderer plugin an internal dependency synchronized from `@amdosion/vue3-print`. The EXE UI must not show a built-in plugin option, version picker, or manual download button. Plugin updates belong to packaging and client auto-update/startup sync.

## Scope

- npm package metadata constants for `@amdosion/vue3-print`.
- Build-time package prefetch into `plugin/` before `electron-builder`.
- Runtime startup package sync before the hidden render window is created.
- Dist-to-cache filename mapping.
- Integrity verification and trusted npm registry URL checks.
- Renderer compatibility diagnostics that do not ask users to select plugin versions in settings.
- Default/current plugin version selection derived from the newest synced compatible cache.

## Acceptance Criteria

- The settings UI and main window do not expose the built-in plugin version, picker, download, or sync controls.
- `src/preload/index.js` does not expose `pluginVersion` to the main UI.
- Packaging runs npm plugin sync before `electron-builder` so the installer includes the current npm plugin.
- Startup checks npm latest and downloads/enables it when the packaged cache is missing or stale.
- Tarball integrity is verified before files are written.
- Tarball download URLs are restricted to the npm registry host.
- Dist files are atomically cached under the existing renderer filenames.
- Missing or incompatible plugin files produce a clear upgrade/restart diagnostic, not another blank renderer or a settings-selection prompt.
- The renderer accepts the current legacy global and the new package global name if a future package publishes it.
- The renderer defines a minimal browser `process.env.NODE_ENV` shim before loading the npm IIFE plugin.
- A fixed `1.0.4` default is removed from the primary config schema path.

## Verification

```powershell
node tools/repro/plugin/npm-package-sync-check.js
node tools/repro/runtime/packaged-file-url-check.js
node --check main.js src/asset-url.js src/set.js src/plugin-package.js src/plugin-sync.js tools/utils.js tools/sync-builtin-plugin.js tools/repro/plugin/npm-package-sync-check.js
npm run sync-plugin
```

## Implementation Progress

2026-06-05 execution:

- Added `tools/repro/plugin/npm-package-sync-check.js` to lock the desired product behavior.
- Added `src/plugin-package.js` as the single npm package/cache contract for `@amdosion/vue3-print`.
- Added `tools/sync-builtin-plugin.js` and made all package build scripts run `npm run sync-plugin` before `electron-builder`.
- Added `src/plugin-sync.js` for startup npm latest sync, integrity verification, trusted tarball host validation, safe extraction, and atomic cache writes.
- Removed the fixed `1.0.4` schema default; the default now derives from the latest compatible cached plugin and falls back only when no compatible cache exists.
- Removed built-in plugin version display from the main UI.
- Removed built-in plugin version picker, manual plugin download, and old npm registry lookup from settings.
- Removed manual plugin IPC exposure from the settings preload and main process.
- Removed `pluginVersion` exposure from the main-window preload.
- Updated renderer plugin global lookup to accept `vue-plugin-hiprint`, `VuePluginHiprint`, `@amdosion/vue3-print`, and `Vue3Print`.
- Added the renderer-side `process.env.NODE_ENV` shim before loading the plugin script.
- Updated plugin error copy so users are told to upgrade/restart instead of choosing a hidden internal plugin in settings.
