import { app, BrowserWindow, dialog } from "electron";
import { openDb, closeDb, getSetting, wasDbCorrupted } from "./db/client";
import { createWindow } from "./window";
import { createTray, destroyTray } from "./tray";
import { registerIpcHandlers } from "./ipc/handlers";
import { startTracker, stopTracker } from "./tracking/tracker";
import {
  closeAllSessions,
  repairOrphanedSessions,
} from "./tracking/sessionManager";
import { initUpdater } from "./updater";
import { autoFetchSteamArtwork } from "./artwork/autoFetch";

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
      app.setLoginItemSettings({
        openAtLogin: launchAtStartup === true || launchAtStartup === "true",
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
  try { closeAllSessions(Date.now()) } catch { /* DB may not be initialised if startup failed */ }
  try { stopTracker() } catch { /* ignore */ }
  destroyTray();
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
  dialog.showErrorBox(
    "Faultier Tracker — Unexpected Error",
    `An unexpected error occurred:\n\n${err.message}`,
  );
  app.quit();
});

process.on("unhandledRejection", (reason) => {
  console.error("[Main] Unhandled rejection:", reason);
});
