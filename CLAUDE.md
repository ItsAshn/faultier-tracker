# Faultier Tracker — Claude Dev Guide

## Project Overview

Faultier Tracker is an Electron + React desktop app for people who want to know exactly how many hours they've put into a piece of software — think Blender, Photoshop, DaVinci Resolve, or any creative/professional tool that isn't on Steam. The core value is a single, honest number: "You spent 47 hours in Blender this month." It automatically tracks which applications are active or running on a Windows machine, polls every 5 seconds, writes sessions to a local SQLite database (via sql.js/WASM), and presents time summaries through a React UI.

**Target user**: A creative or self-learner who uses non-gaming software (3D, video editing, illustration, CAD, coding IDEs, etc.) and wants accountability around how much time they invest in learning or practising those tools. Features should always serve the goal of surfacing meaningful time totals — not gamification for its own sake.

## Tech Stack

- **Electron v33** — desktop runtime
- **Electron Vite v2** — build tooling (separate main/preload/renderer builds)
- **React 18 + TypeScript** — renderer UI
- **sql.js** — SQLite in WASM (no native bindings); custom `better-sqlite3`-compatible wrapper in `src/main/db/client.ts`
- **Zustand** — client-side state management
- **Recharts** — data visualization
- **React Router v6** — page routing
- **electron-updater** — auto-update via GitHub Releases
- **electron-builder** — packaging and NSIS installer for Windows

## Key Commands

```bash
npm run dev       # Start dev server with hot reload
npm run build     # Build JS/CSS bundles
npm run package   # Build + create Windows installer
npm run release   # Build + publish to GitHub Releases (requires GH_TOKEN)
```

## Architecture

The app follows standard Electron architecture with strict process separation:

```
src/
├── main/          # Node.js/Electron main process
│   ├── index.ts          # App lifecycle, startup sequence
│   ├── window.ts         # BrowserWindow creation
│   ├── tray.ts           # System tray
│   ├── updater.ts        # Auto-update logic
│   ├── db/
│   │   ├── client.ts     # sql.js wrapper (better-sqlite3-compatible API)
│   │   └── migrations.ts # Schema, default settings
│   ├── tracking/
│   │   ├── tracker.ts        # 5-second polling loop
│   │   ├── activeWindow.ts   # get-windows wrapper
│   │   ├── processScanner.ts # ps-list wrapper
│   │   └── sessionManager.ts # Open/close session records
│   ├── ipc/
│   │   └── handlers.ts   # All ipcMain.handle() registrations
│   ├── icons/
│   │   └── iconExtractor.ts  # Extract .exe icons → base64
│   ├── grouping/
│   │   └── groupEngine.ts    # Pattern-based auto-grouping
│   └── importExport/
│       ├── dataTransfer.ts   # JSON export/import
│       └── steamImport.ts    # Steam library import
├── preload/
│   └── index.ts   # contextBridge — exposes only typed IPC calls to renderer
├── renderer/      # React SPA
│   ├── App.tsx           # Router setup
│   ├── pages/            # Dashboard, Gallery, Settings
│   ├── components/       # layout/, dashboard/, gallery/, settings/
│   ├── store/            # Zustand stores (appStore, sessionStore, updateStore)
│   ├── api/bridge.ts     # Typed wrappers around window.api IPC calls
│   └── styles/           # Per-page CSS files
└── shared/
    ├── types.ts      # All shared TypeScript interfaces
    └── channels.ts   # IPC channel name constants
```

## IPC Pattern

- Channel names are constants in `src/shared/channels.ts`
- Main registers handlers in `src/main/ipc/handlers.ts`
- Preload exposes them via `contextBridge` in `src/preload/index.ts`
- Renderer calls them through `src/renderer/api/bridge.ts`

When adding a new IPC call:
1. Add channel name to `src/shared/channels.ts`
2. Register `ipcMain.handle()` in `src/main/ipc/handlers.ts`
3. Expose via `contextBridge` in `src/preload/index.ts`
4. Add typed wrapper in `src/renderer/api/bridge.ts`

## Database

- **Engine**: sql.js (SQLite WASM) — no native bindings, works cross-platform
- **File**: `%APPDATA%/Faultier Tracker/data.db`
- **Auto-save**: every 30 seconds
- The DB client in `src/main/db/client.ts` mimics the `better-sqlite3` API (synchronous `.prepare().run()/.get()/.all()`)
- Schema and migrations live in `src/main/db/migrations.ts`

**Core Tables**: `apps`, `app_groups`, `sessions`, `settings`, `group_rules`

## Tracking Loop

`src/main/tracking/tracker.ts` runs every `poll_interval_ms` (default 5000ms):

1. Scans running processes via `ps-list`
2. Gets the focused window via `get-windows`
3. `sessionManager` opens/closes `active` and `running` sessions per app
4. Sends a `TRACKING_TICK` IPC event to the renderer with current state
5. In `blacklist` mode (default), unknown apps are auto-added to the DB

## State Management (Renderer)

- `appStore` — apps, groups, settings, icons cache
- `sessionStore` — time range, summary data, live tick state
- `updateStore` — update download/install state

Stores call `bridge.ts` functions which call preload IPC. Keep business logic in the main process, not in stores.

## Conventions

- All shared types go in `src/shared/types.ts`
- IPC channel strings go in `src/shared/channels.ts` (never hardcode strings)
- Icon data is returned as base64 data URLs
- Date ranges use `date-fns`; time values are stored as milliseconds
- Session records are never deleted during normal operation (only via Settings → clear data)
- The `machine_id` setting (UUID) identifies the device for multi-machine import/export

## Release Process

Triggered by pushing a `v*.*.*` git tag. GitHub Actions (`.github/workflows/release.yml`) runs `npm run release`, which builds the NSIS Windows installer and publishes it as a GitHub Release. The app checks for updates on launch via `electron-updater`.

```bash
git tag v1.2.3
git push origin v1.2.3
```

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
