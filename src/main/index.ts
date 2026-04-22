import { app, BrowserWindow, dialog, protocol } from "electron";
import { join } from "path";
import { is } from "@electron-toolkit/utils";
import { openDb, closeDb, getSetting, wasDbCorrupted } from "./db/client";
import { createWindow, setQuitting } from "./window";
import { createTray, destroyTray } from "./tray";
import { registerIpcHandlers, runStartupSteamDuplicateScan } from "./ipc/handlers";
import { startTracker, stopTracker } from "./tracking/tracker";
import {
  closeAllSessions,
  repairOrphanedSessions,
} from "./tracking/sessionManager";
import { initUpdater } from "./updater";
import { autoFetchSteamArtwork } from "./artwork/autoFetch";
import { importFromSteam, refreshSteamPlaytimes } from "./importExport/steamImport";
import { registerIconProtocol } from "./protocol";

// Steam auto-refresh timer
let steamRefreshTimer: NodeJS.Timeout | null = null;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

async function refreshSteamData(): Promise<void> {
  const apiKey = getSetting("steam_api_key") as string | null;
  const steamId = getSetting("steam_id") as string | null;
  
  if (!apiKey || !steamId) {
    console.log("[SteamRefresh] skipping — no credentials configured");
    return;
  }

  console.log("[SteamRefresh] refreshing Steam playtimes...");
  try {
    const result = await refreshSteamPlaytimes(apiKey, steamId);
    console.log(`[SteamRefresh] updated ${result.updated} games, added ${Math.round(result.totalDeltaMs / 60000)}m of playtime`);
  } catch (err) {
    console.error("[SteamRefresh] failed:", err);
  }
}

function startSteamRefreshTimer(): void {
  // Clear existing timer
  if (steamRefreshTimer) {
    clearInterval(steamRefreshTimer);
  }
  
  // Check if credentials are configured
  const apiKey = getSetting("steam_api_key") as string | null;
  const steamId = getSetting("steam_id") as string | null;
  
  if (apiKey && steamId) {
    console.log("[SteamRefresh] starting auto-refresh timer (every 6 hours)");
    // Initial refresh on startup
    refreshSteamData();
    // Set up interval
    steamRefreshTimer = setInterval(refreshSteamData, SIX_HOURS_MS);
  }
}

// Use a separate userData directory in dev mode so the dev instance
// doesn't conflict with a running production instance (different lock, different DB)
if (is.dev) {
  app.setPath('userData', join(app.getPath('userData'), '-dev'))
}

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// Register kioku:// as a privileged scheme before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'kioku', privileges: { standard: false, secure: true, supportFetchAPI: true, corsEnabled: false } },
]);

app.on("second-instance", () => {
  // Focus the existing window when user tries to open a second instance
  const wins = BrowserWindow.getAllWindows();
  if (wins[0]) {
    if (wins[0].isMinimized()) wins[0].restore();
    wins[0].show();
    wins[0].focus();
  }
});

app.whenReady().then(async () => {
  try {
    openDb();

    if (wasDbCorrupted()) {
      dialog.showMessageBox({
        type: "warning",
        title: "KIOKU — Database Recovered",
        message: "A corrupted database file was detected and backed up. A fresh database has been created.\n\nYour previous data has been preserved in a backup file.",
        buttons: ["OK"],
      });
    }

    repairOrphanedSessions(getSetting("machine_id") as string, Date.now());

    // Sync startup login item with stored preference (packaged app only)
    if (app.isPackaged) {
      const launchAtStartup = getSetting("launch_at_startup");
      const enable = launchAtStartup === true || launchAtStartup === "true";
      app.setLoginItemSettings({
        openAtLogin: enable,
      });
    }

    const win = createWindow();

    // Register ready-to-show immediately after window creation to avoid a race
    // condition where the renderer finishes loading during startTracker() and
    // fires the event before the listener is registered, leaving the window
    // permanently hidden.
    const showTimeout = setTimeout(() => win.show(), 10000);
    win.once("ready-to-show", () => {
      clearTimeout(showTimeout);
      win.show();
      // Background artwork fetch — starts 5s after window appears to avoid blocking startup
      setTimeout(() => autoFetchSteamArtwork().catch(console.error), 5000);
      // Start Steam auto-refresh timer
      startSteamRefreshTimer();
      // Run duplicate scan after renderer is ready so suggestions can be pushed
      setTimeout(() => runStartupSteamDuplicateScan().catch(console.error), 3000);
    });

    createTray(win);
    registerIpcHandlers();
    registerIconProtocol();
    initUpdater();

    // Start tracker non-blocking to prevent hangs on unsupported platforms
    startTracker().catch((err) => {
      console.error("[Main] Tracker failed to start:", err);
    });
  } catch (err) {
    dialog.showErrorBox(
      "KIOKU — Startup Error",
      `The app failed to start:\n\n${err instanceof Error ? err.message : String(err)}`,
    );
    app.quit();
  }
});

app.on("before-quit", () => {
  // Allow the window's close event to proceed — without this, e.preventDefault()
  // in the hide-to-tray handler would permanently block app.quit().
  setQuitting();
  // Clear Steam refresh timer
  if (steamRefreshTimer) {
    clearInterval(steamRefreshTimer);
    steamRefreshTimer = null;
  }
  try { closeAllSessions(Date.now()) } catch { /* DB may not be initialised if startup failed */ }
  try { stopTracker() } catch { /* ignore */ }
  try { destroyTray() } catch { /* ignore */ }
  try { closeDb() } catch { /* ignore */ }
});

// On macOS, keep the app running when all windows are closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // On Windows/Linux, we hide to tray rather than quitting (handled by window.ts)
    // so this event fires rarely; just don't quit here.
  }
});

app.on("activate", () => {
  // On macOS, re-create window when dock icon is clicked with no open windows
  if (BrowserWindow.getAllWindows().length === 0) {
    const win = createWindow();
    win.show();
  }
});

// Crash-rate circuit breaker: only relaunch in production, and cap at 3 crashes per minute
const recentCrashes: number[] = [];
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60_000;

process.on("uncaughtException", (err) => {
  console.error("[Main] Uncaught exception:", err);
  const now = Date.now();
  recentCrashes.push(now);
  while (recentCrashes.length && recentCrashes[0] < now - CRASH_WINDOW_MS) {
    recentCrashes.shift();
  }
  if (app.isPackaged && recentCrashes.length < MAX_CRASHES) {
    app.relaunch();
  }
  app.quit();
});

process.on("unhandledRejection", (reason) => {
  console.error("[Main] Unhandled rejection:", reason);
});
