# Dispatch — Fork Environment Reference

This documents the changes made to fork Superset into "Dispatch" — a dev build that runs alongside the production Superset app, connects to production data, and enables CDP automation.

## How to run

```bash
cd apps/desktop && bun run dev:prod
```

This gives you the full production environment (API, Electric, auth) with Vite hot reload and CDP enabled on port 9333.

## What `dev:prod` does differently from `dev`

| Concern | `dev` | `dev:prod` |
|---------|-------|------------|
| Workspace name | Derived from branch/worktree | Forced to `superset` (no suffix) |
| Branch isolation | Per-branch data dir + protocol | Shared — uses default `.dispatch/` dir |
| CDP | Off unless `DESKTOP_AUTOMATION_PORT` set | Always on, port 9333 |
| `patch-dev-protocol.ts` | Patches Electron.app plist with branch-specific scheme | Skips (workspace name resolves to default) |

## Identity changes (run alongside production Superset)

These prevent Dispatch from conflicting with a running Superset instance:

| Property | Superset | Dispatch |
|----------|----------|---------|
| `productName` (dock name) | `Superset` | `Dispatch` |
| `appId` (bundle ID) | `com.superset.desktop` | `com.dispatch.desktop` |
| Protocol scheme | `superset://` | `dispatch://` |
| Data directory | `~/.superset/` | `~/.dispatch/` |
| Host ID salt | `superset-desktop-device-id-v1` | `dispatch-desktop-device-id-v1` |
| Device identity | Device A | Device B (different HMAC) |

The host ID salt change is critical — without it, both apps register as the same device and the server drops the first connection.

## Files changed

### `apps/desktop/package.json`
- `productName` → `"Dispatch"`
- Added `dev:prod` script

### `apps/desktop/electron-builder.ts`
- `appId` → `"com.dispatch.desktop"`
- Protocol scheme → `"dispatch"`

### `apps/desktop/src/shared/constants.ts`
- `SUPERSET_DIR_NAME` → `.dispatch` / `.dispatch-${workspace}`
- `PROTOCOL_SCHEME` → `dispatch-dev-${workspace}` (workspace branch) / `dispatch` (default)

### `packages/shared/src/constants.ts`
- `PROTOCOL_SCHEMES.DEV` → `"dispatch-dev"`
- `PROTOCOL_SCHEMES.PROD` → `"dispatch"`

### `packages/shared/src/host-info.ts`
- `APP_HOST_SALT` → `"dispatch-desktop-device-id-v1"`

### `apps/desktop/src/lib/electron-app/factories/app/setup.ts`
- Removed `NODE_ENV === "development"` gate on `DESKTOP_AUTOMATION_PORT` — CDP is now enabled in any environment when the env var is set.

### `apps/desktop/src/main/windows/main.ts`
- Added CORS bypass for dev mode: rewrites `Origin` header to `https://app.superset.sh` on outbound requests to `api.superset.sh`, and patches the `access-control-allow-origin` response header to `http://localhost:5173`. Without this, the production API rejects requests from the Vite dev server origin.

### `apps/desktop/src/main/index.ts`
- Dev mode app name → `"Dispatch (${workspaceName})"`

### `apps/desktop/scripts/patch-dev-protocol.ts`
- Protocol → `dispatch-${workspaceName}`
- Bundle ID → `com.dispatch.desktop.${workspaceName}`
- Display name → `"Dispatch (...)"`

## Auth

Auth works via OAuth through the production API (`api.superset.sh`). The desktop app sends `protocol=dispatch` in the auth URL, and the API redirects back to `dispatch://auth/callback?token=...`. You need to sign in once (Dispatch has its own token file at `~/.dispatch/auth-token.enc`).

## CORS bypass

The production API's CORS allowlist includes `https://app.superset.sh` but not `http://localhost:5173`. In dev mode, Electron's `webRequest` API rewrites:
- **Outbound**: `Origin: http://localhost:5173` → `Origin: https://app.superset.sh`
- **Inbound**: `access-control-allow-origin: ""` → `access-control-allow-origin: http://localhost:5173`

This only applies to `api.superset.sh` requests and only in dev mode.

## CDP automation

Set `DESKTOP_AUTOMATION_PORT=9333` (done automatically by `dev:prod`). Test with:

```bash
curl http://localhost:9333/json
```

Returns a JSON array of CDP targets (main renderer + webview panes).

## Things that are still shared

- **Production API** (`api.superset.sh`) — same backend, same account
- **Electric sync** — same real-time database
- **Project-level config** — `.superset/` directories inside repos are unchanged (`PROJECT_SUPERSET_DIR_NAME` stays `.superset`)

## Gotchas

- If you change `DESKTOP_AUTOMATION_PORT` value, update any MCP configs that reference it
- The `agent-setup` module writes hooks to global `~/.claude/settings.json` on launch — this happens from both Superset and Dispatch but the hooks use `$SUPERSET_HOME_DIR` which is resolved at runtime, so they don't conflict
- Production Superset and Dispatch appear as **different devices** to the server (different host IDs), so workspaces created in one won't automatically appear in the other
