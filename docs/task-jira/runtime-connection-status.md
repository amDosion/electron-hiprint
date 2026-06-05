# HIPRINT-RUNTIME: Main Window Must Show Current Connection State

## Context

The main window can show:

```text
中转状态: 未连接
本地连接: 未连接
打印状态: 空闲
```

even when the local print service is already running and transit settings have
been saved/tested. The current renderer only listens for incremental socket
events. It does not request a current state snapshot after the window loads.

The `本地连接` label is also misleading. It represents the number of web/plugin
Socket.IO clients connected to the local service, not whether the local service
itself is running.

## Reproduction Script

```powershell
node tools/repro/runtime/connection-status-check.js
```

Baseline risks:

- `CONNECTION-STATUS-MAIN-SNAPSHOT-MISSING`
- `CONNECTION-STATUS-PRELOAD-CHANNEL-MISSING`
- `CONNECTION-STATUS-RENDERER-SNAPSHOT-MISSING`
- `CONNECTION-STATUS-RENDERER-MERGE-MISSING`
- `TRANSIT-RUNTIME-CONNECT-ERROR-UNOBSERVED`
- `LOCAL-CONNECTION-LABEL-MISLEADING`

## Goal

Make the main window render the current runtime status after loading, then keep
it updated through existing socket events.

## Scope

- Main-process connection status snapshot IPC.
- Index preload allowlist for the snapshot request/response.
- Main window state merge for local client count, transit connection state, and
  print busy state.
- Runtime transit `connect_error` diagnostics.
- Status label wording for local web/plugin client count.

## Acceptance Criteria

- The renderer can request `getConnectionStatus` and receive `connectionStatus`.
- The snapshot includes local web/plugin client count, transit connection state,
  print busy state, and the latest transit error text when present.
- The main window requests the snapshot after registering IPC listeners.
- Existing `serverConnection`, `clientConnection`, and `printTask` events remain
  compatible.
- A runtime transit connection error updates the main window to disconnected and
  records a diagnostic log without exposing the token.
- The UI no longer says `本地连接：未连接` for the external client count.
- Saving settings keeps the existing explicit restart contract.

## Implementation Progress

2026-06-05 execution:

- Added `tools/repro/runtime/connection-status-check.js` before production edits;
  baseline reported 6 status-chain risks.
- Confirmed the local config has `connectTransit=true`, a transit URL, and a
  persisted transit token.
- Confirmed runtime logs include `中转服务 Connected Transit Server` and recurring
  `refreshPrinterList`, so the screenshot's disconnected transit state was a UI
  state synchronization problem rather than a missing saved config.
- Added a main-process status snapshot IPC for the index renderer.
- Added renderer/preload support for `getConnectionStatus` and
  `connectionStatus`.
- Added runtime `connect_error` handling for the transit socket without logging
  the token.
- Renamed the local socket client count label from `本地连接` to `本地客户端`.
- Bumped the client version to `1.0.25`.

## Verification

```powershell
node tools/repro/runtime/connection-status-check.js
node --check main.js src/preload/index.js tools/utils.js tools/repro/runtime/connection-status-check.js
npm run build-w-64
```
