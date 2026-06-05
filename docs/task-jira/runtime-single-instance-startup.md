# HIPRINT-RUNTIME: Single Instance Startup Must Not Continue After Lock Failure

## Context

During local upgrade verification, launching the installed app while an instance was already active produced:

```text
本地服务启动失败: listen EADDRINUSE: address already in use 127.0.0.1:17521
```

The main process called `helper.appQuit()` when `app.requestSingleInstanceLock()` failed, but did not return from `initialize()`, so the second instance continued registering handlers and starting local services.

## Reproduction

```powershell
node tools/repro/runtime/main-process-check.js
```

Baseline risk:

- `MAIN-SINGLE-INSTANCE-CONTINUES-AFTER-QUIT`

## Implementation Progress

2026-06-05 execution:

- Added `tools/repro/runtime/main-process-check.js` before production edits.
- Added an immediate `return` after `helper.appQuit()` in the single-instance no-lock path.
- Rebuilt `out\hiprint_win_x64-1.0.20.exe` and replaced the local installation.
- Verified the installed app can be launched a second time without logging `EADDRINUSE`; the active listener remained owned by the first process on `127.0.0.1:17521`.

## Acceptance Criteria

- The no-lock path exits `initialize()` immediately after `helper.appQuit()`.
- A second app launch focuses the first instance and does not try to bind the local socket service again.
- `node tools/repro/runtime/main-process-check.js` exits 0.

## Verification

```powershell
node tools/repro/runtime/main-process-check.js
node --check main.js
```
