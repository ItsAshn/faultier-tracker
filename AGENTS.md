# AGENTS.md — Faultier Tracker

## Context7 Integration

When checking documentation for libraries/frameworks (React, Electron, sql.js, date-fns,
Recharts, Zustand, Zod, etc.), **always use Context7** for up-to-date, version-specific docs
instead of training data.

## Build Commands

```bash
npm run dev          # Start dev server (Electron + Vite hot reload)
npm run build        # Build production bundles
npm run preview      # Preview built app
npm run package      # Build + create Windows installer (NSIS)
npm run release      # Build + publish to GitHub (needs GH_TOKEN env var)
```

## Type Checking & Linting

**No test framework. No ESLint/Prettier.** Validate changes with:

```bash
npx tsc --noEmit                          # Type-check all files (root tsconfig)
npx tsc --noEmit -p tsconfig.web.json    # Renderer only
npx tsc --noEmit -p tsconfig.node.json   # Main process + preload only
```

Always run the relevant type-check command after making changes. Fix all errors before committing.

## Tech Stack

- **Electron v33** — desktop runtime (Windows-only)
- **Electron Vite v2** — build tooling (main/preload/renderer bundles)
- **React 18 + TypeScript 5** — UI (`strict: true` in both tsconfigs)
- **sql.js v1** — SQLite WASM; API mimics better-sqlite3 (no native bindings)
- **Zustand v4** — state management
- **React Router v6** — `HashRouter`; routes: `/gallery`, `/app/:id`, `/group/:id`, `/settings`
- **Recharts v2** — charts
- **date-fns v3** — date formatting/arithmetic
- **Zod v3** — schema validation
- **Fuse.js v7** — fuzzy search
- **get-windows v9** — active window detection (replaces `active-win`)
- **ps-list v8** — process enumeration
- **lucide-react** — icons
- **electron-updater v6** — auto-update

## Project Structure

```
src/
├── main/                  # Electron main process (Node.js)
│   ├── artwork/           # SteamGridDB auto-fetch (autoFetch.ts, artworkProvider.ts)
│   ├── db/                # sql.js client singleton, schema migrations (v1–v8)
│   ├── grouping/          # Pattern-based auto-grouping engine
│   ├── icons/             # .exe icon extraction → base64 data URLs
│   ├── importExport/      # JSON export/import, Steam API import
│   ├── ipc/               # ipcMain handler registration (handlers.ts, channels.ts)
│   ├── tracking/          # 5s polling loop (tracker.ts), session manager
│   ├── utils/             # exeNameResolver.ts
│   ├── index.ts           # App lifecycle, startup sequence
│   ├── tray.ts            # System tray
│   ├── updater.ts         # electron-updater integration
│   └── window.ts          # BrowserWindow creation
├── preload/
│   └── index.ts           # contextBridge — exposes typed IPC api to renderer
├── renderer/              # React SPA
│   ├── api/
│   │   └── bridge.ts      # Typed wrappers around window.api (+ browser stub)
│   ├── components/        # Organized by feature: dashboard/, gallery/, detail/, layout/, ui/
│   ├── pages/             # AppDetailPage.tsx, Gallery.tsx, Settings.tsx
│   ├── store/             # Zustand stores: appStore.ts, sessionStore.ts, updateStore.ts
│   ├── styles/            # Per-feature CSS modules + global.css (CSS variables)
│   ├── App.tsx            # Router, IPC push subscriptions, error boundary
│   └── main.tsx           # ReactDOM.createRoot, HashRouter
└── shared/
    ├── channels.ts        # ALL IPC channel name constants (CHANNELS object)
    ├── types.ts           # ALL shared TypeScript interfaces
    └── exeNames.json      # exe → display name mapping
```

## IPC Pattern (Critical)

**Never hardcode channel strings.** When adding any new IPC endpoint, always touch all 4 files:

1. `src/shared/channels.ts` — add the channel constant to `CHANNELS`
2. `src/main/ipc/handlers.ts` — register `ipcMain.handle(CHANNELS.YOUR_CHANNEL, ...)`
3. `src/preload/index.ts` — expose via `contextBridge.exposeInMainWorld`
4. `src/renderer/api/bridge.ts` — add a typed wrapper function

Push-event subscribers (e.g. `onTick`) must return a `() => void` cleanup function that calls
`ipcRenderer.removeListener(...)`. Call these cleanup functions in `useEffect` returns.

## Code Style

### Imports

Order: React/built-in types → third-party → `@shared/*` → `@renderer/*` → relative paths.
Use **single quotes** for all import paths. Example:

```typescript
import { useState, useEffect } from 'react'
import type { AppRecord } from '@shared/types'
import { api } from '../../api/bridge'
```

### Formatting

- **Indent:** 2 spaces
- **String literals:** double quotes (`"value"`), import paths: single quotes (`'react'`)
- **Semicolons:** required
- **Trailing commas:** required in multi-line arrays/objects/params

### Naming

| Context | Convention | Example |
|---|---|---|
| Components / Types / Interfaces | PascalCase | `AppRecord`, `SummaryCard` |
| Functions / variables | camelCase | `loadAll`, `setAppTracked` |
| Constants | UPPER_SNAKE_CASE | `CHANNELS`, `POLL_INTERVAL` |
| DB columns | snake_case | `exe_name`, `group_id`, `is_tracked` |
| IPC channels | `domain:action` | `apps:getAll`, `tracking:tick` |
| CSS classes | BEM | `app-card__art--placeholder` |

### TypeScript

- `strict: true` — never use `any` except in legacy DB generics
- Prefer `interface` over `type` alias
- Explicit return types on all exported functions: `function foo(): void`
- Time values: milliseconds (`number`); dates: `'YYYY-MM-DD'` strings
- Nullable fields: `string | null` (not `string | undefined` unless optional prop)
- Path aliases: `@shared/*` (both processes), `@renderer/*` (renderer only)

### React Components

```typescript
// Correct pattern
interface Props {
  item: AppRecord;
  onClick: () => void;
}

export default function AppCard({ item, onClick }: Props): JSX.Element {
  // useCallback for handlers passed as props to children
  // useEffect cleanup: return () => subscription.remove()
}
```

- Functional components only; return type `JSX.Element`
- Destructure props in the function signature
- `useCallback` for handlers passed to child components
- Always return a cleanup function from `useEffect` when subscribing

### State Management (Zustand Stores)

```typescript
// Standard store pattern
async loadAll() {
  set({ loading: true, error: null })
  try {
    const data = await api.getData()
    set({ data, loading: false })
  } catch (err) {
    set({ loading: false, error: String(err) })
  }
}
```

- All business logic lives in the **main process**; stores only call bridge → IPC
- Every store exposes `error: string | null` and `clearError(): void`
- Optimistic updates: save previous state, revert in catch

### Error Handling

- Wrap all async operations in `try/catch`
- Log with `[ClassName]` or `[IPC]` prefixes: `console.error('[AppStore] ...', err)`
- In IPC handlers, `throw` after logging so the renderer receives the rejection
- Main process registers global `uncaughtException` and `unhandledRejection` handlers

### CSS / Styling

- BEM class names: `block__element--modifier`
- All colors/spacing via CSS variables: `var(--color-accent)`, `var(--space-4)`
- Dark-only design; do not add light-mode styles
- Key CSS variables: `--color-bg`, `--color-surface`, `--color-surface-2`, `--color-accent`
  (`#f59e0b` amber), `--color-text`, `--color-text-muted`, `--color-danger`, `--color-success`

### Database

- `getDb()` returns the singleton `DbCompat` (better-sqlite3-style wrapper over sql.js)
- Call `getDb()` inside handler functions, never at module load time
- Generic prepare: `db.prepare<Params[], RowType>(sql)`
- SQLite stores booleans as `0`/`1`; map to `boolean` in `mapApp()` helper
- Auto-saves to `%APPDATA%/Faultier Tracker/data.db` every 30 seconds
- Schema version tracked in `schema_migrations`; add new migrations in `migrations.ts`
- **Never delete sessions** in normal app operation

## Key Files

| File | Purpose |
|---|---|
| `src/shared/types.ts` | All TypeScript interfaces (`AppRecord`, `AppGroup`, `SessionSummary`, …) |
| `src/shared/channels.ts` | IPC channel constants — single source of truth |
| `src/main/ipc/handlers.ts` | All `ipcMain.handle()` registrations (~975 lines) |
| `src/preload/index.ts` | `contextBridge` — the only way renderer accesses Node/Electron |
| `src/renderer/api/bridge.ts` | Typed renderer-side wrappers; also provides browser stubs for Vite dev |
| `src/main/db/client.ts` | DB singleton, `openDb()`, `getDb()`, auto-save timer |
| `src/main/db/migrations.ts` | Schema creation and incremental migrations |
| `electron.vite.config.ts` | Build config; defines `@shared` and `@renderer` path aliases |

## Release

Push a `v*.*.*` tag to trigger the GitHub Actions release workflow:

```bash
git tag v1.2.3
git push origin v1.2.3
```

Or use the `/ship` custom command for a guided release flow.

## Important Constraints

- **Windows-only** — uses Windows-specific APIs (`get-windows`, icon extraction)
- **No Node.js in renderer** — all Node/Electron access must go through `contextBridge`
- **No ESLint/Prettier** — manually follow the style rules above; type-check with `tsc`
- **Icons** are returned as base64 data URLs (not file paths)
- **`group_rules` table** was dropped in migration v7 — do not reference it
- **Session type** is always `'active'`; `'running'` type no longer exists

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
