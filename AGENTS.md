# AGENTS.md — KIOKU

## Context7 Integration

When checking docs for any library/framework used here (React, Electron, sql.js, date-fns,
Recharts, Zustand, Zod, etc.), **always use Context7** for up-to-date, version-specific docs
rather than relying on training data.

## Build Commands

```bash
npm run dev          # Start dev server (Electron + Vite hot reload)
npm run build        # Build production bundles (main + preload + renderer)
npm run preview      # Preview built app in Electron
npm run package      # Build + create Windows NSIS installer
npm run release      # Build + publish to GitHub Releases (needs GH_TOKEN)
```

## Type Checking (no test framework, no ESLint/Prettier)

```bash
npx tsc --noEmit                        # Type-check everything (root tsconfig)
npx tsc --noEmit -p tsconfig.web.json  # Renderer + preload + shared only
npx tsc --noEmit -p tsconfig.node.json # Main process + preload only
```

**Always run the relevant type-check after changes. Fix all errors before committing.**

## Tech Stack

| Package | Version | Role |
|---|---|---|
| Electron | v33 | Desktop runtime (Windows-only) |
| electron-vite | v2 | Build tooling (3 separate bundles) |
| React + TypeScript | 18 / 5 | Renderer UI (`strict: true`) |
| sql.js | v1 | SQLite WASM — no native bindings |
| Zustand | v4 | Client-side state |
| React Router | v6 | `HashRouter` |
| Recharts | v2 | Charts |
| date-fns | v3 | Date formatting/arithmetic |
| Zod | v3 | Schema validation |
| Fuse.js | v7 | Fuzzy search |
| get-windows | v9 | Active window detection |
| ps-list | v8 | Process enumeration |
| electron-updater | v6 | Auto-update via GitHub Releases |

## Project Structure

```
src/
├── main/                  # Node.js / Electron main process
│   ├── artwork/           # SteamGridDB auto-fetch (autoFetch.ts, artworkProvider.ts)
│   ├── db/                # sql.js singleton + migrations v1–v8 (client.ts, migrations.ts)
│   ├── grouping/          # Pattern-based auto-grouping engine (groupEngine.ts)
│   ├── icons/             # .exe icon extraction → base64 (iconExtractor.ts)
│   ├── importExport/      # JSON export/import + Steam import (dataTransfer.ts, steamImport.ts)
│   ├── ipc/               # All ipcMain.handle() registrations (handlers.ts)
│   ├── tracking/          # 5s polling loop (tracker.ts), session manager
│   ├── utils/             # exeNameResolver.ts
│   ├── index.ts           # App lifecycle + startup sequence
│   ├── tray.ts            # System tray
│   ├── updater.ts         # electron-updater integration
│   └── window.ts          # BrowserWindow creation
├── preload/
│   └── index.ts           # contextBridge — sole gateway from renderer to Node/Electron
├── renderer/              # React SPA
│   ├── api/bridge.ts      # Typed wrappers around window.api; browser stub for Vite dev
│   ├── components/        # dashboard/, gallery/, detail/, layout/, ui/
│   ├── pages/             # AppDetailPage.tsx, Gallery.tsx, Settings.tsx
│   ├── store/             # Zustand stores: appStore.ts, sessionStore.ts, updateStore.ts
│   ├── styles/            # Per-feature CSS modules + global.css (CSS variables)
│   ├── App.tsx            # Router, IPC push subscriptions, error boundary
│   └── main.tsx           # ReactDOM.createRoot entry point
└── shared/
    ├── channels.ts        # ALL IPC channel name constants (CHANNELS object)
    ├── types.ts           # ALL shared TypeScript interfaces
    └── exeNames.json      # exe → display name overrides
```

## IPC Pattern (Critical — touch all 4 files for every new endpoint)

1. `src/shared/channels.ts` — add constant to `CHANNELS` (`domain:action` format)
2. `src/main/ipc/handlers.ts` — `ipcMain.handle(CHANNELS.YOUR_CHANNEL, ...)`
3. `src/preload/index.ts` — expose via `contextBridge.exposeInMainWorld`
4. `src/renderer/api/bridge.ts` — add typed wrapper + stub for browser dev

**Never hardcode channel strings.** Push-event subscribers (e.g. `onTick`) must return a
`() => void` cleanup that calls `ipcRenderer.removeListener(...)`. Use this in `useEffect` returns.

## Code Style

### Imports

Order: React/built-ins → third-party → `@shared/*` → `@renderer/*` → relative paths.
Single quotes for import paths; double quotes for string values.

```typescript
import { useState, useEffect } from 'react'
import type { AppRecord } from '@shared/types'
import { CHANNELS } from '@shared/channels'
import { api } from '../../api/bridge'
```

### Formatting

- **Indent:** 2 spaces
- **Semicolons:** required
- **Trailing commas:** required in multi-line arrays/objects/params
- **Quotes:** single `'` in imports; double `"` for string literals

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

```typescript
interface Props {
  item: AppRecord;
  onClick: () => void;
}

export default function AppCard({ item, onClick }: Props): JSX.Element {
  // useCallback for handlers passed as props to children
  // useEffect must return cleanup: return () => unsubscribe()
}
```

- Functional components only, return type `JSX.Element`
- Destructure props in signature
- `useCallback` for handlers passed to children

### Zustand Stores

```typescript
async loadAll() {
  set({ loading: true, error: null });
  try {
    const data = await api.getData();
    set({ data, loading: false });
  } catch (err) {
    set({ loading: false, error: String(err) });
  }
}
```

- Business logic stays in the **main process** — stores only call bridge → IPC
- Every store exposes `error: string | null` and `clearError(): void`
- Optimistic updates: save previous state, revert in catch

### Error Handling

- Wrap all async operations in `try/catch`
- Log with `[ModuleName]` prefix: `console.error('[AppStore] failed to load', err)`
- IPC handlers: `throw` after logging so the renderer receives the rejection
- Main process has global `uncaughtException` / `unhandledRejection` handlers in `index.ts`

### CSS / Styling

- BEM class names: `block__element--modifier`
- All colors/spacing through CSS variables — never hardcode hex/px
- Dark-only design; do **not** add light-mode styles
- Key variables: `--color-bg`, `--color-surface`, `--color-surface-2`,
  `--color-accent` (`#f59e0b` amber), `--color-text`, `--color-text-muted`,
  `--color-danger`, `--color-success`, `--space-{n}`

### Database

- `getDb()` returns the `DbCompat` singleton — call it **inside** handler functions, never at module scope
- `db.prepare<Params[], RowType>(sql)` — always type both generics
- SQLite booleans are `0`/`1` integers; convert to `boolean` via the `mapApp()` helper in `handlers.ts`
- Auto-saves to `%APPDATA%/Faultier Tracker/data.db` every 30 seconds via `persistDb()`
- Schema version tracked in `schema_migrations`; new migrations go in `migrations.ts` (currently v8)
- **Never delete session rows** in normal operation — only via Settings → clear data

## Key Files

| File | Purpose |
|---|---|
| `src/shared/types.ts` | All TypeScript interfaces (`AppRecord`, `AppGroup`, `SessionSummary`, …) |
| `src/shared/channels.ts` | IPC channel constants — single source of truth |
| `src/main/ipc/handlers.ts` | All `ipcMain.handle()` registrations (~992 lines) |
| `src/preload/index.ts` | `contextBridge` — only renderer→Node gateway |
| `src/renderer/api/bridge.ts` | Typed renderer wrappers + browser stub |
| `src/main/db/client.ts` | DB singleton, `openDb()`, `getDb()`, `persistDb()` |
| `src/main/db/migrations.ts` | Schema creation + incremental migrations |
| `electron.vite.config.ts` | Build config; defines `@shared` and `@renderer` path aliases |

## Important Constraints

- **Windows-only** — uses `get-windows`, icon extraction via VBScript/PowerShell
- **No Node.js in renderer** — all Node/Electron access goes through `contextBridge`
- **No ESLint/Prettier** — follow style rules manually; validate with `tsc --noEmit`
- **Icons** are base64 data URLs (never file paths in the renderer)
- **`group_rules` table** was dropped in migration v7 — do not reference it
- **Session `type`** is always `'active'`; `'running'` no longer exists

## Release

```bash
git tag v1.2.3 && git push origin v1.2.3
```

GitHub Actions (`.github/workflows/release.yml`) runs on `v*.*.*` tags, builds the NSIS
installer on `windows-latest`, and publishes to GitHub Releases. Use `/ship` for a guided flow.

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
