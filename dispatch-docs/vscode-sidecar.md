# VS Code Inline Sidecar for Superset Desktop

## Context

cmux (a Swift/macOS terminal app at `~/GitHub/personal/cmux`) has a feature where you can open VS Code as an inline tab — it launches VS Code's built-in `code-tunnel serve-web` command which starts a local web server, then renders the VS Code web UI inside a browser panel. We want the same thing in Superset's Electron desktop app.

Superset already has all the primitives: browser panes with persistent webviews, an "Open In" editor dropdown with VS Code icons, and tRPC IPC. The main work is adding the serve-web process manager and wiring the UI.

## How cmux Does It

1. Detects VS Code, finds `code-tunnel` binary inside the app bundle
2. Spawns `code-tunnel serve-web --accept-server-license-terms --host 127.0.0.1 --port 0 --connection-token-file <tokenfile>` with `ELECTRON_RUN_AS_NODE=1`
3. Parses stdout for `Web UI available at http://127.0.0.1:XXXXX?tkn=...`
4. Appends `&folder=/path/to/workspace` to the URL
5. Opens the URL in an inline browser panel
6. Singleton manager — one serve-web process shared across all panels (just swap the `folder` param)

## Implementation Plan

### Step 1: VscodeServeWebManager (Main Process)

**New file:** `apps/desktop/src/main/lib/vscode-serve-web/vscode-serve-web-manager.ts`
**New file:** `apps/desktop/src/main/lib/vscode-serve-web/index.ts` (barrel export)

Singleton `EventEmitter` that manages the `code-tunnel serve-web` child process:

- **`resolveCodeTunnelBinary(variant)`** — Checks `/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code-tunnel` (and Insiders equivalent). Returns path or `null`.
- **`ensureRunning(variant)`** — If process already running, returns cached base URL. Otherwise spawns the process:
  - Generate UUID token via `crypto.randomUUID()`
  - Write to temp file at `os.tmpdir()/superset-vscode-token-...` with `0o600` permissions
  - Spawn with env `ELECTRON_RUN_AS_NODE=1`, args: `serve-web --accept-server-license-terms --host 127.0.0.1 --port 0 --connection-token-file <path>`
  - Pipe stdout, scan line-by-line for `Web UI available at http://...`
  - 60-second timeout, kill + reject if URL not found
  - Cache the base URL
- **`buildFolderUrl(baseUrl, folderPath)`** — Appends `?folder=<path>` to base URL
- **`stop(variant)` / `stopAll()`** — SIGTERM, delete token file, clear cached URL
- **Cleanup on process exit** — Delete token file, clear state, emit status event

Pattern reference: `apps/desktop/src/main/lib/host-service-coordinator.ts` (similar singleton process manager)

### Step 2: tRPC Router

**New file:** `apps/desktop/src/lib/trpc/routers/vscode-inline/index.ts`

Procedures:
- `isInstalled` (query) — checks if `code-tunnel` binary exists for given variant
- `getUrl` (mutation) — starts serve-web if needed, returns URL with `folder` param. Input: `{ variant: "vscode" | "vscode-insiders", folderPath: string }`
- `stop` (mutation) — stops the serve-web process
- `onStatusChange` (subscription) — Observable-based (NOT async generators per AGENTS.md)

**Modify:** `apps/desktop/src/lib/trpc/routers/index.ts`
- Register: `vscodeInline: createVscodeInlineRouter()`

### Step 3: UI — Add Inline Options to Editor Dropdown

**Modify:** `apps/desktop/src/renderer/components/OpenInExternalDropdown/constants.ts`
- Add `VSCODE_INLINE_OPTIONS` array with `vscode-inline` and `vscode-insiders-inline` entries, reusing existing icon imports

**Modify:** `apps/desktop/src/renderer/components/OpenInExternalDropdown/OpenInExternalDropdownItems.tsx`
- Add optional `onOpenInline?: (variant: "vscode" | "vscode-insiders") => void` prop
- In the VS Code submenu, after Standard/Insiders items, add separator + inline options
- Only render inline section when `onOpenInline` is provided

### Step 4: Wire Up Entry Points

**Modify:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/V2OpenInMenuButton/V2OpenInMenuButton.tsx`
- Add `workspaceId` prop
- Add `vscodeInline.getUrl` tRPC mutation
- On success → `addBrowserTab(workspaceId, url)`
- On error → toast
- Pass `onOpenInline` callback to `OpenInExternalDropdownItems`

**Modify:** `apps/desktop/src/renderer/routes/_authenticated/_dashboard/components/TopBar/components/V2WorkspaceOpenInButton/V2WorkspaceOpenInButton.tsx`
- Pass `workspaceId` through to `V2OpenInMenuButton`

### Step 5: Cleanup on Quit

**Modify:** `apps/desktop/src/main/index.ts`
- In `before-quit` handler, call `vscodeServeWebManager.stopAll()` alongside existing `getHostServiceCoordinator().stopAll()`

## Key Design Decisions

- **Reuse browser panes** — No new pane type needed. VS Code web UI is just a URL opened in an existing `webview` pane.
- **Singleton process** — One serve-web process per VS Code variant, shared across all workspaces. Different workspaces just use different `?folder=` URLs.
- **Separate from ExternalApp enum** — Inline VS Code is orthogonal to the external app system. No changes to `@superset/local-db` schema needed.
- **Security** — Localhost-only, random port, UUID connection token in `0o600` temp file, cleaned up on exit.

## Files Summary

| File | Action |
|------|--------|
| `src/main/lib/vscode-serve-web/vscode-serve-web-manager.ts` | Create |
| `src/main/lib/vscode-serve-web/index.ts` | Create |
| `src/lib/trpc/routers/vscode-inline/index.ts` | Create |
| `src/lib/trpc/routers/index.ts` | Modify (register router) |
| `src/renderer/components/OpenInExternalDropdown/constants.ts` | Modify (add inline options) |
| `src/renderer/components/OpenInExternalDropdown/OpenInExternalDropdownItems.tsx` | Modify (add inline items + prop) |
| `src/renderer/routes/.../V2OpenInMenuButton.tsx` | Modify (wire up inline handler) |
| `src/renderer/routes/.../V2WorkspaceOpenInButton.tsx` | Modify (pass workspaceId) |
| `src/main/index.ts` | Modify (cleanup on quit) |

All paths relative to `apps/desktop/`.

## Verification

1. Install VS Code (if not already) and verify `code-tunnel` exists in the bundle
2. Run `bun dev` in the desktop app
3. Open a workspace, click "Open In" → "IDE" → "VS Code" → see the new "Standard (Inline)" / "Insiders (Inline)" options
4. Click "Standard (Inline)" — should see a new browser tab open with VS Code's web UI loaded to the workspace's folder
5. Open a second workspace and click inline again — should reuse the same serve-web process with a different `?folder=` URL
6. Quit the app — verify the serve-web process is terminated (no orphan `code-tunnel` process via `ps aux | grep code-tunnel`)
7. Test with VS Code not installed — should show a toast error
8. Run `bun run typecheck` and `bun run lint` to verify no type/lint errors
