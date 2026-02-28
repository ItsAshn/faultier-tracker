# Faultier Tracker

> **Know where your hours go.** Faultier Tracker automatically monitors which applications you use and for how long — no manual timers, no input required.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Electron](https://img.shields.io/badge/Electron-v33-47848F?logo=electron)
![React](https://img.shields.io/badge/React-v18-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-v5-3178C6?logo=typescript)

---

## What It Does

Faultier Tracker runs quietly in your system tray and tracks every application you use. It distinguishes between:

- **Active time** — the app has your focus (window in foreground)
- **Running time** — the app is open but not focused (background)

All data is stored locally in a SQLite database. Nothing is sent to any server.

## Features

- **Automatic tracking** — polls every 5 seconds with no user input required
- **Dashboard** — view daily, weekly, monthly, or custom time range summaries with bar charts
- **Gallery** — browse all tracked apps and groups, edit metadata, set custom icons
- **App groups** — organize apps into categories (Browsers, Games, Dev Tools, etc.) with pattern-based auto-grouping
- **Blacklist / Whitelist modes** — track everything by default, or only what you explicitly allow
- **Steam import** — pull your Steam game library in one click
- **Data export & import** — full JSON backup and restore
- **Auto-updates** — checks for new releases on launch via GitHub

## Screenshots

> Dashboard, Gallery, and Settings pages

*(Add screenshots here)*

---

## Installation

Download the latest installer from the [Releases](https://github.com/ItsAshn/faultier-tracker/releases) page and run the `.exe`.

The app installs per-user (no admin required) and starts tracking immediately. It lives in your system tray.

**Data location**: `%APPDATA%\Faultier Tracker\`

---

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
git clone https://github.com/ItsAshn/faultier-tracker.git
cd faultier-tracker
npm install
```

### Run in Development

```bash
npm run dev
```

Starts Electron with hot reload for the renderer process.

### Build

```bash
npm run build      # Build JS/CSS bundles only
npm run package    # Build + create Windows NSIS installer
```

### Release

Releases are automated via GitHub Actions. Push a version tag to trigger a build and publish:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The workflow builds the installer and creates a GitHub Release. The app will detect the update on next launch.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron v33 |
| Build tool | Electron Vite v2 |
| UI | React 18, TypeScript |
| State | Zustand |
| Charts | Recharts |
| Database | sql.js (SQLite/WASM) |
| Styling | Plain CSS |
| Packaging | electron-builder (NSIS) |
| Updates | electron-updater |

---

## Project Structure

```
src/
├── main/          # Electron main process (Node.js)
│   ├── tracking/  # Polling loop, process/window detection, session management
│   ├── db/        # sql.js client, schema migrations
│   ├── ipc/       # IPC handlers (main ↔ renderer bridge)
│   ├── icons/     # .exe icon extraction
│   ├── grouping/  # Auto-grouping engine
│   └── importExport/
├── preload/       # contextBridge — secure IPC exposure
├── renderer/      # React SPA (pages, components, Zustand stores)
└── shared/        # Shared TypeScript types and IPC channel constants
```

---

## License

MIT
