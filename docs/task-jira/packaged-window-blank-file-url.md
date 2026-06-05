# HIPRINT-RUNTIME: Packaged Windows Must Load Local HTML Assets

## Context

After installing the `1.0.20` package, the main window and settings window opened as blank white pages. Running the packaged app with a remote debugging port showed page targets with empty URLs, while the main process logs showed normal startup.

Root symptom:

```text
path.join("file://", "C:\\...\\resources\\app.asar", "assets/index.html")
=> .\file:\C:\...\resources\app.asar\assets\index.html
```

That is not a valid `file:///C:/...` URL on Windows.

Reproduction script:

```powershell
node tools/repro/runtime/packaged-file-url-check.js
```

Current baseline reports:

- `RUNTIME-WINDOWS-FILE-URL-PATH-JOIN`
- `RUNTIME-ASSET-URL-HELPER-MISSING`
- `RUNTIME-PRELOAD-SANDBOX-BLOCKS-COMMONJS`

## Implementation Progress

2026-06-05 execution:

- Added `tools/repro/runtime/packaged-file-url-check.js` before production edits; baseline reported `observed: 6`.
- Added `src/asset-url.js` to generate packaged asset URLs with `pathToFileURL`.
- Replaced all `path.join("file://", ...)` local HTML loads in `main.js`, `src/set.js`, `src/print.js`, `src/render.js`, and `src/printLog.js`.
- Kept existing CommonJS preload modules working under Electron 42 by explicitly setting `sandbox: false` on windows that use those preloads.
- Regression script now reports `observed: 0`.
- Rebuilt and installed `out\hiprint_win_x64-1.0.20.exe`; local config hash stayed `CF1EC086719830C3C745DFE650E8695B23842DCC878EE5DDF99F39C9FDFF4346`.
- Remote debugging verification showed main/settings URLs load as `file:///C:/.../resources/app.asar/assets/*.html`, `window.hiprintIndex` and `window.hiprintSet` are exposed, and Vue template placeholders are gone.
- Visual screenshot verification confirmed the settings window renders actual form content instead of a blank white page.

## Goal

Make every packaged BrowserWindow and BrowserView load local HTML assets through a Windows-safe URL builder.

## Scope

- Shared local asset URL helper.
- Main window loading page and index page.
- Settings window loading page and settings page.
- Print, render, and print-log windows.

## Acceptance Criteria

- No window code uses `path.join("file://", ...)`.
- Local asset URLs are generated with `pathToFileURL`.
- Windows that load the existing CommonJS preloads explicitly set `sandbox: false` while keeping `nodeIntegration: false` and `contextIsolation: true`.
- Packaged app main and settings pages have non-empty remote-debugging URLs.
- Installed app no longer opens blank white windows.

## Verification

```powershell
node tools/repro/runtime/packaged-file-url-check.js
node --check main.js src/asset-url.js src/set.js src/print.js src/render.js src/printLog.js
npm run build-w-64
```
