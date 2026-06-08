# Transit Security Coordination Task / Jira

## TRANSIT-SEC-001 Align plugin, transit, Vue-admin, and Android around backend-owned authorization

Status: Open / reproduced

### Problem

The current print stack has two different control paths:

- Browser template-designer path: Vue-admin returns a usable transit token to the browser default remote-print config, then the npm plugin connects directly to `node-hiprint-transit`.
- Browser listing-print path: Vue-admin calls backend `/api/mobile/print/listing/jobs`; Vue-admin reads the stored transit host/token and dispatches to transit.
- Android path: Android logs in to Vue-admin only, then calls backend mobile print APIs; Vue-admin reads the stored transit host/token and dispatches to transit.

The backend-mediated listing-print and Android paths are the safer target model because transit credentials stay on the backend. The browser template-designer path still exposes the transit token to the browser and lets any socket with that token request privileged transit events.

### Reproduction Script

Added:

```text
E:\Source_code\electron-hiprint\tools\repro\security\transit-coordination-risk-check.js
```

Command:

```powershell
node tools\repro\security\transit-coordination-risk-check.js
```

Current result:

```text
observed: 6
TRANSIT-SEC-TOKEN-EXPOSED-TO-BROWSER
TRANSIT-SEC-PLUGIN-DIRECT-CREDENTIAL-SURFACE
TRANSIT-SEC-SHARED-TOKEN-CONTROLS-PRIVILEGED-EVENTS
TRANSIT-SEC-DEFAULT-OR-WEAK-TOKEN
TRANSIT-SEC-TOKEN-LOGGING
TRANSIT-SEC-EPHEMERAL-SOCKET-ID-AS-DEVICE-ID
```

### Current Evidence

- Vue-admin `/api/hiprint/remote-print-configs/default` returns the decrypted transit token for browser silent print.
- Vue-admin browser print service calls plugin `hiprint.connectTransit({ host, token })`.
- `@amdosion/vue3-print` exposes `connectTransit({ host, token })` and `hiwebSocket.setHost(host, token)` as public compatibility APIs; this is acceptable as a legacy/dev surface but not as the normal production authorization path.
- `node-hiprint-transit` authenticates all sockets with the same token and then permits print/file-export forwarding events.
- Transit has a default token fallback and the local checked config uses a short default-like token.
- Transit startup output and Electron local auth failure logging can expose token material.
- Transit client routing uses Socket.IO `socket.id` as the client id; Vue-admin and Android can therefore persist stale print targets after reconnect.

### Target Architecture

- Vue-admin is the authorization and configuration source of truth.
- `node-hiprint-transit` is only the transport broker; it should not be treated as the business authorization layer.
- Electron client registers as a print agent with a stable device identity, ideally based on an enrolled agent id / machine id instead of socket id.
- Android never stores transit credentials. It should continue to call Vue-admin mobile print APIs only.
- Browser plugin in Vue-admin should prefer backend-mediated print dispatch. Direct plugin-to-transit should be legacy/dev-only or protected behind an explicit compatibility flag.
- Transit credentials should be strong, rotated, not logged, and scoped by role where practical.

### Cooperation Contract

| Component | Production responsibility | Must not own |
| --- | --- | --- |
| `vue-admin-main` backend | User auth, tenant/user isolation, remote print config storage, decrypting transit token, template/listing permission checks, dispatching print/file-export jobs to transit. | Browser-side transit credential exposure. |
| `node-hiprint-transit` | Socket transport, online agent/printer state, forwarding approved print/file-export packets to registered Electron agents. | Business authorization, listing/template/data permission decisions. |
| `electron-hiprint` client | Register as a print agent, expose stable agent/printer capabilities, execute approved print/file-export jobs. | Prompting users to manage npm plugin artifacts or exposing secrets in logs. |
| `@amdosion/vue3-print` plugin | Render/design/preview, maintain legacy direct-transit APIs for compatibility, support host-provided backend dispatch hooks. | Being the production authorization layer or requiring raw transit token in Vue-admin browser code. |
| `UrovoShipmentScanner` Android app | Login to Vue-admin, select backend-provided remote printer targets, submit mobile print jobs, store only business JWT/session and selected client/printer IDs. | Storing or connecting with transit host/token. |

### Target Runtime Flows

1. Android remote print:
   `Android -> Vue-admin JWT API -> /api/mobile/print/listing/jobs -> backend dispatch -> node-hiprint-transit -> Electron print agent`.
2. Vue-admin listing print:
   `Browser -> Vue-admin JWT API -> /api/mobile/print/listing/jobs -> backend dispatch -> node-hiprint-transit -> Electron print agent`.
3. Vue-admin template-designer silent print target:
   `Browser -> Vue-admin JWT API -> backend print dispatch endpoint -> node-hiprint-transit -> Electron print agent`.
4. Plugin direct transit:
   Keep as compatibility/dev only. It can remain in the npm package, but Vue-admin production should not call it unless an explicit compatibility flag is enabled.

### Acceptance Criteria

- Browser-facing Vue-admin APIs no longer expose raw transit tokens for normal production print dispatch.
- Backend dispatch validates current user, template permission, listing/data permission, configured client, and configured printer before sending to transit.
- Vue-admin template-designer silent print can dispatch through backend without calling `hiprint.connectTransit({ host, token })` in the normal production path.
- Transit can distinguish Electron print agents from web/API dispatchers or otherwise scope allowed events by role.
- Transit client routing uses a stable registered client identity, with socket id kept as a transport detail.
- Token startup/auth-failure logs are masked or removed.
- Default/weak transit tokens are rejected or replaced during init/startup for production use.
- Android remote print continues to work through Vue-admin without storing the transit token.

### Verification Baseline

- `node tools\repro\security\static-risk-check.js` in `electron-hiprint` -> 0 observed legacy Electron security risks.
- `npm test` in `node-hiprint-transit` -> 20 passed.
- `.\backend\venv\Scripts\python.exe -m pytest backend\tests\routers\test_mobile_print.py backend\tests\routers\test_hiprint_contract.py -q --no-cov` in `vue-admin-main` -> 38 passed.
- `node tools\repro\security\transit-coordination-risk-check.js` in `electron-hiprint` -> 6 reproduced cross-stack risks.

### Recommended Fix Sequence

1. Remove token logging and reject default/weak transit tokens in `node-hiprint-transit` and `electron-hiprint`.
2. Add stable Electron agent identity to transit registration and Vue-admin remote print config; keep socket id as runtime routing detail only.
3. Add backend dispatch endpoint for Vue-admin template-designer silent print so browser code can print without receiving the transit token.
4. Change Vue-admin template-designer production path to call backend dispatch. Keep plugin `connectTransit` only behind an explicit legacy/dev compatibility flag.
5. Add role/scoped auth to transit or split credentials for print-agent vs dispatcher connections.
6. Update Android and Vue-admin printer target resolution to prefer stable agent id and refresh socket id at dispatch time.

### Risks

- Removing browser direct transit token immediately may break current Vue-admin silent print until backend-mediated browser print dispatch is implemented.
- Switching from socket id to stable agent id needs migration for existing saved remote printer configs.
- Transit role-scoped auth changes must preserve compatibility with the packaged Electron client and the npm plugin.
