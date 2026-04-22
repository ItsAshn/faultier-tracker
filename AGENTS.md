# AGENTS.md — KIOKU

## Context7 Integration

When checking docs for any library/framework (React, Electron, sql.js, date-fns, Recharts,
Zustand, Zod, etc.), **always use Context7** for up-to-date, version-specific docs rather
than relying on training data.

## Build & Type-Check Commands

```bash
npm run dev          # Electron + Vite dev server with hot reload
npm run build        # Production bundles (main + preload + renderer)
npm run package      # Build + create Windows NSIS installer
npm run release      # Build + publish to GitHub Releases (needs GH_TOKEN)
```

**No test framework, no ESLint/Prettier.** Type-checking is the only automated validation:

```bash
npx tsc --noEmit                        # Check everything (root tsconfig)
npx tsc --noEmit -p tsconfig.web.json  # Renderer + preload + shared only
npx tsc --noEmit -p tsconfig.node.json # Main process + preload only
```

**Always run the relevant type-check after changes. Fix all errors before committing.**

## Tech Stack

| Package | Version | Role |
|---|---|---|
| Electron | v33 | Desktop runtime (Windows-only) |
| electron-vite | v2 | Build tooling (3 entry bundles) |
| React + TypeScript | 18 / 5 | Renderer UI (`strict: true`) |
| sql.js | v1 | SQLite WASM — no native bindings |
| Zustand | v4 | Client-side state |
| React Router | v6 | `HashRouter` |
| Recharts | v2 | Charts |
| date-fns | v3 | Date formatting/arithmetic |
| Zod | v3 | Schema validation (import validation) |
| Fuse.js | v7 | Fuzzy search |
| get-windows | v9 | Active window detection |
| ps-list | v8 | Process enumeration |
| electron-updater | v6 | Auto-update via GitHub Releases |

## Project Structure

```
src/
├── main/                  # Node.js / Electron main process
│   ├── artwork/           # SteamGridDB auto-fetch
│   ├── db/                # sql.js singleton + migrations v1–v9 (client.ts, migrations.ts)
│   ├── grouping/          # Pattern-based auto-grouping (groupEngine.ts)
│   ├── icons/             # .exe icon extraction → base64 (iconExtractor.ts)
│   ├── importExport/      # JSON/CSV export, JSON import, Steam import
│   ├── ipc/               # All ipcMain.handle() registrations (handlers.ts, ~1254 lines)
│   ├── tracking/          # 5s polling loop (tracker.ts) + sessionManager.ts
│   ├── utils/             # exeNameResolver.ts
│   ├── index.ts           # App lifecycle + startup sequence
│   ├── tray.ts            # System tray icon + tooltip
│   ├── updater.ts         # electron-updater integration
│   └── window.ts          # BrowserWindow creation
├── preload/index.ts       # contextBridge — sole IPC gateway to renderer
├── renderer/              # React SPA
│   ├── api/bridge.ts      # Typed wrappers around window.api + browser stub
│   ├── components/        # dashboard/, gallery/, detail/, layout/, settings/, setup/
│   ├── pages/             # AppDetailPage.tsx, Gallery.tsx, Settings.tsx
│   ├── store/             # Zustand: appStore.ts, sessionStore.ts, updateStore.ts
│   ├── styles/            # Per-feature CSS + global.css (CSS variables)
│   ├── App.tsx            # Router, IPC push subscriptions, error boundary
│   └── main.tsx           # ReactDOM.createRoot entry point
└── shared/
    ├── channels.ts        # ALL IPC channel name constants (CHANNELS object)
    ├── types.ts           # ALL shared TypeScript interfaces
    └── exeNames.json      # exe → display name overrides
```

## IPC Pattern — Touch All 4 Files for Every New Endpoint

1. `src/shared/channels.ts` — add constant to `CHANNELS` (`domain:action` format)
2. `src/main/ipc/handlers.ts` — `ipcMain.handle(CHANNELS.X, async (_e, ...args) => { ... })`
3. `src/preload/index.ts` — expose via `contextBridge.exposeInMainWorld`
4. `src/renderer/api/bridge.ts` — add typed wrapper + browser-mode stub

**Never hardcode channel strings.** Push-event subscribers (e.g. `onTick`) must return a
`() => void` cleanup calling `ipcRenderer.removeListener(...)` — use as `useEffect` return.

## Code Style

### Imports
Order: React/Node built-ins → third-party → `@shared/*` → `@renderer/*` → relative.
Single quotes for paths; double quotes for string values in code.

```typescript
import { useState, useEffect } from 'react'
import type { AppRecord } from '@shared/types'
import { CHANNELS } from '@shared/channels'
import { api } from '../../api/bridge'
```

### Formatting
- **Indent:** 2 spaces — **Semicolons:** required — **Trailing commas:** required in multi-line
- **Quotes:** single `'` in imports; double `"` for string literals elsewhere

### Naming Conventions

| Context | Convention | Example |
|---|---|---|
| Components / Types / Interfaces | PascalCase | `AppRecord`, `SummaryCard` |
| Functions / variables | camelCase | `loadAll`, `setAppTracked` |
| Constants | UPPER_SNAKE_CASE | `CHANNELS`, `POLL_INTERVAL` |
| DB columns | snake_case | `exe_name`, `group_id`, `is_tracked` |
| IPC channels | `domain:action` | `apps:getAll`, `tracking:tick` |
| CSS classes | BEM | `app-card__art--placeholder` |

### TypeScript
- `strict: true` — never use `any` except in legacy DB row generics
- Prefer `interface` over `type` alias
- Explicit return types on all exported functions: `function foo(): ReturnType`
- Time values: milliseconds (`number`); dates: `'YYYY-MM-DD'` strings
- Nullable fields: `T | null` (not `T | undefined` unless it's an optional prop)
- Path aliases: `@shared/*` (both processes), `@renderer/*` (renderer only)

### React Components
- Functional components only, return type `JSX.Element`, destructure props in signature
- `useCallback` for handlers passed as props to children
- Every `useEffect` that subscribes must return a cleanup: `return () => unsubscribe()`

```typescript
interface Props { item: AppRecord; onClick: () => void; }
export default function AppCard({ item, onClick }: Props): JSX.Element { ... }
```

### Zustand Stores
- Business logic stays in the **main process** — stores only call `api.*` → IPC
- Every store exposes `error: string | null` and `clearError(): void`
- Optimistic updates: snapshot previous state, revert on catch

```typescript
async loadAll() {
  set({ loading: true, error: null });
  try { set({ data: await api.getData(), loading: false }); }
  catch (err) { set({ loading: false, error: String(err) }); }
}
```

### Error Handling
- Wrap all async operations in `try/catch`
- Log with `[ModuleName]` prefix: `console.error('[Tracker] poll failed', err)`
- IPC handlers: log then `throw` so the renderer receives the rejection
- Global `uncaughtException` / `unhandledRejection` handlers live in `src/main/index.ts`

### CSS / Styling
- BEM class names; all colors/spacing through CSS variables — never hardcode hex/px
- Dark-only design; do **not** add light-mode styles
- Key variables: `--color-bg`, `--color-surface`, `--color-surface-2`,
  `--color-accent` (`#f59e0b` amber), `--color-text`, `--color-text-muted`,
  `--color-danger`, `--color-success`, `--space-{n}`

### Database
- `getDb()` returns the `DbCompat` singleton — call it **inside** handler functions, never at module scope
- `db.prepare<Params[], RowType>(sql)` — always type both generics
- SQLite booleans are `0`/`1` integers; convert via `mapApp()` helper in `handlers.ts`
- Auto-saves to `%APPDATA%/KIOKU/data.db` every 30 seconds via `persistDb()`
- Schema tracked in `schema_migrations`; new migrations go in `migrations.ts` (currently v9)
- **Never delete session rows** in normal operation — only via Settings → clear data

## Key Files

| File | Purpose |
|---|---|
| `src/shared/types.ts` | All TypeScript interfaces (`AppRecord`, `AppGroup`, `SessionSummary`, …) |
| `src/shared/channels.ts` | IPC channel constants — single source of truth |
| `src/main/ipc/handlers.ts` | All `ipcMain.handle()` registrations (~1254 lines) |
| `src/preload/index.ts` | `contextBridge` — only renderer→Node gateway |
| `src/renderer/api/bridge.ts` | Typed renderer wrappers + browser stub |
| `src/main/db/client.ts` | DB singleton, `openDb()`, `getDb()`, `persistDb()` |
| `src/main/db/migrations.ts` | Schema creation + incremental migrations (v1–v9) |
| `electron.vite.config.ts` | Build config; defines `@shared` and `@renderer` path aliases |

## Important Constraints

- **Windows + Linux** — uses `get-windows` on Windows, native commands on Linux (X11/Wayland/Hyprland)
- **No Node.js in renderer** — all Node/Electron access goes through `contextBridge`
- **No ESLint/Prettier** — follow style rules manually; validate with `tsc --noEmit`
- **Icons** are base64 data URLs — never file paths in the renderer
- **`group_rules` table** was dropped in migration v7 — do not reference it
- **Session `type`** is always `'active'`; `'running'` no longer exists
- **`linked_steam_app_id`** column added in migration v9 — present on `apps` table

## Release

```bash
git tag v1.2.3 && git push origin v1.2.3
```

GitHub Actions (`.github/workflows/release.yml`) triggers on `v*.*.*` tags, builds Windows + Linux
packages (AppImage, deb, tar.gz), and publishes to GitHub Releases. Use `/ship` for a guided flow.

### /ship Command

When user invokes `/ship`:

1. Run type-check: `npx tsc --noEmit`
2. Stage all changes: `git add -A`
3. Commit with message (if there are changes)
4. Bump version: `npm version minor --no-git-tag-version` (or patch/major as appropriate)
5. **Update version references**:
   - No additional version references to update
6. Stage version changes: `git add README.md`
7. Commit version bump: `git commit -m "Bump version to X.X.X"`
8. Create tag: `git tag vX.X.X`
9. Push commits: `git push origin main`
10. Push tag: `git push origin vX.X.X`

Only AppImage, deb, and tar.gz packages are built for Linux.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **sloth-tracker** (493 symbols, 1227 relationships, 37 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## When Debugging

1. `gitnexus_query({query: "<error or symptom>"})` — find execution flows related to the issue
2. `gitnexus_context({name: "<suspect function>"})` — see all callers, callees, and process participation
3. `READ gitnexus://repo/sloth-tracker/process/{processName}` — trace the full execution flow step by step
4. For regressions: `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` — see what your branch changed

## When Refactoring

- **Renaming**: MUST use `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` first. Review the preview — graph edits are safe, text_search edits need manual review. Then run with `dry_run: false`.
- **Extracting/Splitting**: MUST run `gitnexus_context({name: "target"})` to see all incoming/outgoing refs, then `gitnexus_impact({target: "target", direction: "upstream"})` to find all external callers before moving code.
- After any refactor: run `gitnexus_detect_changes({scope: "all"})` to verify only expected files changed.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Tools Quick Reference

| Tool | When to use | Command |
|------|-------------|---------|
| `query` | Find code by concept | `gitnexus_query({query: "auth validation"})` |
| `context` | 360-degree view of one symbol | `gitnexus_context({name: "validateUser"})` |
| `impact` | Blast radius before editing | `gitnexus_impact({target: "X", direction: "upstream"})` |
| `detect_changes` | Pre-commit scope check | `gitnexus_detect_changes({scope: "staged"})` |
| `rename` | Safe multi-file rename | `gitnexus_rename({symbol_name: "old", new_name: "new", dry_run: true})` |
| `cypher` | Custom graph queries | `gitnexus_cypher({query: "MATCH ..."})` |

## Impact Risk Levels

| Depth | Meaning | Action |
|-------|---------|--------|
| d=1 | WILL BREAK — direct callers/importers | MUST update these |
| d=2 | LIKELY AFFECTED — indirect deps | Should test |
| d=3 | MAY NEED TESTING — transitive | Test if critical path |

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/sloth-tracker/context` | Codebase overview, check index freshness |
| `gitnexus://repo/sloth-tracker/clusters` | All functional areas |
| `gitnexus://repo/sloth-tracker/processes` | All execution flows |
| `gitnexus://repo/sloth-tracker/process/{name}` | Step-by-step execution trace |

## Self-Check Before Finishing

Before completing any code modification task, verify:
1. `gitnexus_impact` was run for all modified symbols
2. No HIGH/CRITICAL risk warnings were ignored
3. `gitnexus_detect_changes()` confirms changes match expected scope
4. All d=1 (WILL BREAK) dependents were updated

## CLI

- Re-index: `npx gitnexus analyze`
- Check freshness: `npx gitnexus status`
- Generate docs: `npx gitnexus wiki`

<!-- gitnexus:end -->
