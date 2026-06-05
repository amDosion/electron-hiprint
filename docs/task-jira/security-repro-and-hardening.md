# HIPRINT-SEC: Security Reproduction And Hardening Tasks

## Context

Codex added safe reproduction scripts under `tools/repro/security/` before defining these tasks.

Repro scripts:

- `tools/repro/security/static-risk-check.js`: offline source/config check. Current vulnerable baseline reports 9 reproduced risks.
- `tools/repro/security/socket-runtime-repro.js`: runtime check for unauthenticated socket access, reflected CORS, and optional renderer Node marker payload.
- `tools/repro/security/ipp-ssrf-repro.js`: local-only proof that peer-controlled `ippRequest.url` can trigger an outbound request.
- `tools/repro/security/README.md`: usage and exit codes.

Baseline verification already run:

```powershell
node --check tools/repro/security/static-risk-check.js
node --check tools/repro/security/socket-runtime-repro.js
node --check tools/repro/security/ipp-ssrf-repro.js
node tools/repro/security/static-risk-check.js
```

The static script currently exits `1` and reports these reproduced risks:

- `SEC-AUTH-DEFAULT-EMPTY`
- `SEC-SOCKET-BINDS-ALL-INTERFACES`
- `SEC-CORS-REFLECTS-ORIGIN`
- `SEC-NODE-ENABLED-RENDERERS`
- `SEC-REMOTE-HTML-INNERHTML`
- `OPS-SOCKET-BUFFER-10GB`
- `SEC-PLUGIN-DOWNLOAD-NO-INTEGRITY`
- `SUPPLY-NO-LOCKFILE`
- `SUPPLY-ELECTRON-17-EOL`

## Implementation Progress

2026-06-05 first execution slice:

- Patched `HIPRINT-SEC-1` owning boundaries for generated token auth, loopback bind default, and CORS allowlist behavior.
- Patched `HIPRINT-SEC-3` owning boundaries for local and transit IPP target URL validation.
- Patched `HIPRINT-OPS-4` by reducing Socket.IO `maxHttpBufferSize` to 50 MB.
- Updated `static-risk-check.js` to keep validating `maxHttpBufferSize` when it is assigned through a numeric constant.
- Static verification now reports 5 remaining risks instead of 9. Remaining static risks are `HIPRINT-SEC-2`, `HIPRINT-SUP-6`, `HIPRINT-SUP-5`, and `HIPRINT-SUP-7`.
- Runtime verification against a fresh restarted app is still required for `HIPRINT-SEC-1` and `HIPRINT-SEC-3`.

2026-06-05 final execution:

- Completed `HIPRINT-SEC-2` with per-window preload bridges, `nodeIntegration: false`, `contextIsolation: true`, and sanitized remote HTML insertion.
- Completed `HIPRINT-SUP-5` with a committed `package-lock.json`.
- Completed `HIPRINT-SUP-6` by downloading the npm tarball for `vue-plugin-hiprint`, verifying registry `dist.integrity`, extracting only the expected `dist` files, and atomically replacing plugin files.
- Completed `HIPRINT-SUP-7` by upgrading to Electron `^42.3.3`, electron-builder `^26.8.1`, Socket.IO `^4.8.3`, and sqlite3 `^6.0.1`.
- Moved local service startup out of main-window `dom-ready`; the socket server now starts once after print/render background windows are ready.
- Added packaging exclusions so `.omx/`, `docs/`, `tools/repro/`, and `out/` are not included in `app.asar`.
- Final static verification reports `observed: 0`.
- Runtime verification passed against both a development Electron instance on `127.0.0.1:17522` and packaged `out/win-unpacked/hiprint.exe` on `127.0.0.1:17523`.
- `npm audit --json` reports 0 vulnerabilities.
- `npm run build-w-64` produced `out/hiprint_win_x64-1.0.19.exe`.

## Global Acceptance Gate

After remediation, this full gate should pass:

```powershell
node tools/repro/security/static-risk-check.js
npm run start
node tools/repro/security/socket-runtime-repro.js
node tools/repro/security/socket-runtime-repro.js --send-marker-payload
node tools/repro/security/ipp-ssrf-repro.js
```

Expected hardened result:

- Static script exits `0` with `observed: 0`.
- Runtime scripts exit `0`.
- Marker payload does not write a marker file.
- IPP SSRF script shows no outbound probe request.

## HIPRINT-SEC-1: Close Unauthorized Local Service Access

### Goal

Remove the default unauthenticated socket attack surface by fixing auth, bind host, and CORS together.

### Scope

- `tools/utils.js`: token schema and `initServeEvent` auth middleware.
- `main.js`: `server.listen(...)` host binding and Socket.IO CORS.
- Settings UI/config if token generation, bind host, or LAN exposure settings are introduced.

### Acceptance Criteria

- Socket auth is always enforced. Missing or wrong token is rejected.
- First run with no stored token generates and persists a strong random token.
- `server.listen` passes an explicit host. Default is loopback.
- LAN exposure is explicit opt-in and requires auth.
- CORS no longer reflects arbitrary `requestOrigin`.
- Legitimate clients can still connect when configured with the correct token and allowed origin.

### Verification

```powershell
node tools/repro/security/static-risk-check.js
npm run start
node tools/repro/security/socket-runtime-repro.js
node tools/repro/security/socket-runtime-repro.js --token <valid-token>
```

### Risk

Critical. This is the first layer of the main attack chain. Partial fixes still leave reachable paths.

## HIPRINT-SEC-2: Break Remote HTML To Renderer Code Execution

### Goal

Stop remote-provided print HTML from executing in a privileged renderer.

### Scope

- `main.js`
- `src/set.js`
- `src/print.js`
- `src/render.js`
- `src/printLog.js`
- `assets/print.html`
- `assets/render.html`
- New preload/context bridge files if needed.

### Acceptance Criteria

- Renderer windows use `nodeIntegration: false` and `contextIsolation: true`.
- Preload exposes only the minimum IPC APIs required by each window.
- Remote HTML is sanitized or rendered in an isolated, unprivileged context.
- Existing HTML, PDF, JSON-template print, JPEG/PDF render, print log, and settings flows still work.

### Verification

```powershell
node tools/repro/security/static-risk-check.js
npm run start
node tools/repro/security/socket-runtime-repro.js --send-marker-payload
```

The marker payload must not write a file after hardening.

### Risk

Critical. This is a larger refactor because current renderer code directly uses `require`, jQuery, Electron IPC, and plugin globals.

## HIPRINT-SEC-3: Validate IPP Request Targets

### Goal

Prevent peer-controlled IPP URLs from being used as SSRF targets.

### Scope

- `tools/utils.js`: local `ippPrint` and `ippRequest` handlers.
- `tools/utils.js`: transit `ippPrint` and `ippRequest` handlers.
- Shared URL validation helper if introduced.

### Acceptance Criteria

- URL protocol and host are validated before calling `ipp.Printer` or `ipp.request`.
- Default policy rejects loopback, private, link-local, metadata, and otherwise disallowed targets unless explicitly allowed.
- Rejected targets return a structured `ippPrinterCallback` or `ippRequestCallback` error without crashing.
- Valid configured printer endpoints still work.

### Verification

```powershell
npm run start
node tools/repro/security/ipp-ssrf-repro.js
```

Expected hardened result: no outbound request reaches the local probe server.

### Risk

High, potentially critical when combined with unauthenticated access.

## HIPRINT-OPS-4: Reduce Socket Payload DoS Surface

### Goal

Replace the current 10 GB Socket.IO payload limit with a bounded operational limit.

### Scope

- `main.js`: `maxHttpBufferSize`.
- Documentation for large jobs, especially `printByFragments`.

### Acceptance Criteria

- `maxHttpBufferSize` is no more than a documented MB-level limit.
- Oversized single messages are rejected without OOM risk.
- Large intended print jobs use the existing fragment path or a documented alternative.

### Verification

```powershell
node tools/repro/security/static-risk-check.js
```

`OPS-SOCKET-BUFFER-10GB` should be `not_observed`.

### Risk

High. Low implementation cost, but large existing payload integrations may need migration guidance.

## HIPRINT-SUP-5: Restore Supply Chain Reproducibility

### Goal

Make dependency resolution reproducible.

### Scope

- `.gitignore`
- `package-lock.json`
- CI/install documentation if present.

### Acceptance Criteria

- `package-lock.json` is no longer ignored.
- A lockfile is generated and committed.
- CI or release process uses `npm ci`.

### Verification

```powershell
node tools/repro/security/static-risk-check.js
npm ci
```

`SUPPLY-NO-LOCKFILE` should be `not_observed`.

### Risk

High supply-chain risk, low behavior risk.

## HIPRINT-SUP-6: Harden Plugin Download Integrity

### Goal

Ensure downloaded plugin JS/CSS files are complete and trusted before execution.

### Scope

- `src/set.js`: `downloadPlugin`.
- Plugin metadata/checksum source if introduced.

### Acceptance Criteria

- Downloads write to a temporary file first and atomically rename after validation.
- Completion waits for `fileStream` `finish`, not just response `end`.
- Request, response, and stream errors reject and clean partial files.
- Downloaded files are validated by checksum or signature before use.

### Verification

```powershell
node tools/repro/security/static-risk-check.js
```

`SEC-PLUGIN-DOWNLOAD-NO-INTEGRITY` should be `not_observed`.

### Risk

High. Downloaded plugin code is later loaded into the app.

## HIPRINT-SUP-7: Upgrade Electron Runtime

### Goal

Move off Electron 17 and onto a supported Electron runtime.

### Scope

- `package.json`
- Lockfile
- Native module rebuilds, especially `sqlite3` and printing-related packages.
- Build scripts and packaging smoke tests.

### Acceptance Criteria

- Electron version is upgraded to a supported major version.
- App starts locally.
- Windows/macOS/Linux packaging strategy is verified or documented.
- Printing, PDF, tray, settings, and SQLite logging are smoke-tested.

### Verification

```powershell
node tools/repro/security/static-risk-check.js
npm run start
npm run build-w-64
```

`SUPPLY-ELECTRON-17-EOL` should be `not_observed`.

### Risk

High. This should be a separate PR after renderer isolation work reduces upgrade friction.

## Recommended Execution Order

1. P0: `HIPRINT-SEC-1`, `HIPRINT-SEC-2`, `HIPRINT-SEC-3`, and `HIPRINT-OPS-4`.
2. P1: `HIPRINT-SUP-5` and `HIPRINT-SUP-6`.
3. P1 separate PR: `HIPRINT-SUP-7`.

## Notes

- Static checks are regex-based and can be fooled by equivalent rewrites. Runtime scripts and positive functional tests are the stronger acceptance evidence.
- The renderer marker payload intentionally writes only a small temp marker file. Do not replace it with shell execution.
- Security-sensitive fixes should receive a security review before release.
