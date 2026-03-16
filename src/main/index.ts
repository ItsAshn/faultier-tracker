import { app, BrowserWindow, dialog } from "electron";
import * as path from "path";
import * as fs from "fs";
import { execSync } from "child_process";
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

// Steam auto-refresh timer
let steamRefreshTimer: NodeJS.Timeout | null = null;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function createShortcut(targetPath: string, shortcutPath: string): void {
  const vbscript = `
Set WshShell = CreateObject("WScript.Shell")
Set shortcut = WshShell.CreateShortcut("${shortcutPath.replace(/\\/g, "\\\\")}")
shortcut.TargetPath = "${targetPath.replace(/\\/g, "\\\\")}"
shortcut.WorkingDirectory = "${path.dirname(targetPath).replace(/\\/g, "\\\\")}"
shortcut.Save
`;
  const tempVbs = path.join(app.getPath("temp"), "create_shortcut.vbs");
  fs.writeFileSync(tempVbs, vbscript);
  try {
    execSync(`cscript //Nologo "${tempVbs}"`, { windowsHide: true });
  } finally {
    try { fs.unlinkSync(tempVbs); } catch { /* ignore */ }
  }
}

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

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

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
    await openDb();

    if (wasDbCorrupted()) {
      dialog.showMessageBox({
        type: "warning",
        title: "Faultier Tracker — Database Recovered",
        message: "A corrupted database file was detected and backed up. A fresh database has been created.\n\nYour previous data has been preserved in a backup file.",
        buttons: ["OK"],
      });
    }

    repairOrphanedSessions(getSetting("machine_id") as string, Date.now());

    // Sync startup login item with stored preference (packaged app only)
    if (app.isPackaged) {
      const launchAtStartup = getSetting("launch_at_startup");
      const enable = launchAtStartup === true || launchAtStartup === "true";
      const exePath = process.execPath;
      const startupFolder = path.join(app.getPath("home"), "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
      const shortcutPath = path.join(startupFolder, "Faultier Tracker.lnk");

      if (enable) {
        createShortcut(exePath, shortcutPath);
      } else {
        try {
          fs.unlinkSync(shortcutPath);
        } catch { /* ignore if doesn't exist */ }
      }
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
    initUpdater();

    await startTracker();
  } catch (err) {
    dialog.showErrorBox(
      "Faultier Tracker — Startup Error",
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

// Global exception handlers to prevent silent crashes
process.on("uncaughtException", (err) => {
  console.error("[Main] Uncaught exception:", err);
  // Relaunch before quitting so the app self-heals instead of just dying.
  app.relaunch();
  app.quit();
});

process.on("unhandledRejection", (reason) => {
  console.error("[Main] Unhandled rejection:", reason);
});
