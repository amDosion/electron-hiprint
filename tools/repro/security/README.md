# Security Reproduction Scripts

These scripts reproduce the current security and operational risks without changing production code.

Run them from the repository root.

## Offline checks

```powershell
node tools/repro/security/static-risk-check.js
```

Expected before hardening: exit code `1`, with `RISK_REPRODUCED` entries for static configuration risks.

## Runtime socket and renderer checks

Start the Electron client first:

```powershell
npm run start
```

Then run:

```powershell
node tools/repro/security/socket-runtime-repro.js
```

Expected before hardening: exit code `1` if unauthenticated socket access and reflected CORS are observed.

Optional renderer execution marker:

```powershell
node tools/repro/security/socket-runtime-repro.js --send-marker-payload
```

The marker payload writes a small file under the OS temp directory through the renderer's Node context. It uses a missing `url_pdf` path to avoid successful printing.

## IPP SSRF check

Start the Electron client first, then run:

```powershell
node tools/repro/security/ipp-ssrf-repro.js
```

Expected before hardening: exit code `1` if a peer-controlled `ippRequest` URL causes the app to call the local probe server.

## Exit codes

- `0`: risk not observed by the script.
- `1`: risk reproduced.
- `2`: environment problem, usually the Electron client is not running or not reachable.
