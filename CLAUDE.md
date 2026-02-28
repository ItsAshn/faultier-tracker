# Faultier Tracker — Claude Dev Guide

## Project Overview

Faultier Tracker is an Electron + React desktop app that automatically tracks which applications are active or running on a Windows machine. It polls every 5 seconds, writes sessions to a local SQLite database (via sql.js/WASM), and presents time summaries through a React UI.

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
