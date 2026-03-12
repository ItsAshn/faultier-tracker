import { BrowserWindow, powerMonitor } from "electron";
import { getDb, getSetting, setSetting, upsertApp, type RawApp } from "../db/client";
import { getActiveApp, initActiveWin } from "./activeWindow";
import {
  tickActive,
  endActiveSession,
  initSessionManager,
} from "./sessionManager";
import { resolveGroup } from "../grouping/groupEngine";
import { updateTrayTooltip } from "../tray";
import { CHANNELS } from "@shared/channels";
import type { AppRecord, TickPayload } from "@shared/types";
import { getDisplayNameFromExe } from "../utils/exeNameResolver";

// Convert a raw DB row to a renderer-safe AppRecord (mirrors mapApp in handlers.ts)
function toAppRecord(raw: RawApp): AppRecord {
  return {
    id: raw.id,
    exe_name: raw.exe_name,
    exe_path: raw.exe_path,
    display_name: raw.display_name,
    group_id: raw.group_id,
    is_tracked: raw.is_tracked !== 0,
    is_steam_import: raw.is_steam_import !== 0,
    icon_cache_path: raw.icon_cache_path,
    custom_image_path: raw.custom_image_path,
    first_seen: raw.first_seen,
    last_seen: raw.last_seen,
  };
}

let pollTimer: NodeJS.Timeout | null = null;
let isRunning = false;

export async function startTracker(): Promise<void> {
  const machineId = getSetting("machine_id") as string;
  initSessionManager(machineId);

  await initActiveWin();

  isRunning = true;
  await pollTick(); // fire immediately so renderer exits "Connecting…" on launch
  schedulePoll();
  console.log("[Tracker] Started");
}

export function stopTracker(): void {
  isRunning = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  console.log("[Tracker] Stopped");
}

function schedulePoll(): void {
  if (!isRunning) return;
  const interval = (getSetting("poll_interval_ms") as number) ?? 5000;
  pollTimer = setTimeout(async () => {
    await pollTick();
    schedulePoll();
  }, interval);
}

async function pollTick(): Promise<void> {
  const now = Date.now();

  // Default payload sent even when the poll body throws, so the renderer
  // always receives a heartbeat and never gets stuck on "Connecting…".
  let payload: TickPayload = {
    active_app: null,
    timestamp: now,
    is_idle: false,
  };

  try {
    // Persist the current tick time so repairOrphanedSessions can use it on
    // the next startup after a crash. Inside the try so a transient DB error
    // doesn't stop the polling loop.
    setSetting("last_track_time", now);

    const idleThreshold = (getSetting("idle_threshold_ms") as number) ?? 300000;
    const idleSecs = powerMonitor.getSystemIdleTime();
    const isIdle = idleSecs * 1000 >= idleThreshold;

    const activeApp = await getActiveApp();

    console.log(`[Tracker] tick — idle=${isIdle} (${idleSecs}s) activeApp=${activeApp?.exeName ?? 'none'} pid=${activeApp?.pid ?? '-'}`);

    const db = getDb();

    // ── Active window ────────────────────────────────────────────────
    let activeAppId: number | null = null;
    let activeDisplayName: string | null = null;

    if (activeApp) {
      // Single query fetches all fields we need for this app — avoids 3 sequential lookups
      let appRow = db
        .prepare<
          [string],
          | {
              id: number;
              exe_name: string;
              display_name: string;
              is_tracked: number;
              exe_path: string | null;
              group_id: number | null;
            }
          | undefined
        >("SELECT id, exe_name, display_name, is_tracked, exe_path, group_id FROM apps WHERE exe_name = ?")
        .get(activeApp.exeName);

      let appId: number;
      if (!appRow) {
        const displayName = getDisplayNameFromExe(activeApp.exeName);
        console.log(`[Tracker] active window new app: ${activeApp.exeName} -> "${displayName}"`);
        // All new apps start tracked by default (is_tracked=1)
        appId = upsertApp(
          activeApp.exeName,
          activeApp.exePath,
          displayName,
          now,
          1,
        );
        const groupId = await resolveGroup(activeApp.exeName, activeApp.exePath);
        if (groupId !== null) {
          db.prepare<[number, number], void>(
            "UPDATE apps SET group_id = ? WHERE id = ?",
          ).run(groupId, appId);
        }
        // Notify renderer of the newly discovered app
        const newApp = db
          .prepare<[number], RawApp>("SELECT * FROM apps WHERE id = ?")
          .get(appId);
        if (newApp) {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed())
              win.webContents.send(CHANNELS.TRACKING_APP_SEEN, toAppRecord(newApp));
          });
        }
        // Re-fetch so we have a full record for the logic below
        appRow = db
          .prepare<
            [string],
            | {
                id: number;
                exe_name: string;
                display_name: string;
                is_tracked: number;
                exe_path: string | null;
                group_id: number | null;
              }
            | undefined
          >("SELECT id, exe_name, display_name, is_tracked, exe_path, group_id FROM apps WHERE exe_name = ?")
          .get(activeApp.exeName);
      } else {
        appId = appRow.id;
      }

      // ── Skip tracking for Steam games ─────────────────────────────────
      // Steam games use API playtime only, no local tracking
      const isSteamGame = appRow && appRow.exe_name?.startsWith('steam:');
      
      if (isSteamGame && appRow) {
        console.log(`[Tracker] Steam game active, using API time only: ${appRow.exe_name}`);
        endActiveSession(now);
        // Continue to update last_seen and other metadata
        db.prepare<[number, number], void>(
          'UPDATE apps SET last_seen = ? WHERE id = ?'
        ).run(now, appRow.id);
      } else if (appRow && appRow.is_tracked !== 0 && !isIdle) {
        tickActive(appId, now);
        activeAppId = appId;
        activeDisplayName = appRow.display_name;

        // Update exe_path if we now have it; if this is the first time we get
        // the path AND the app has no group yet, re-run group resolution so
        // Steam library path matching can kick in.
        if (activeApp.exePath && !appRow.exe_path) {
          console.log(`[Tracker] updating exe_path for app id=${appId}: ${activeApp.exePath}`);
          db.prepare<[string, number], void>(
            "UPDATE apps SET exe_path = ? WHERE id = ?",
          ).run(activeApp.exePath, appId);

          if (!appRow.group_id) {
            const groupId = await resolveGroup(activeApp.exeName, activeApp.exePath);
            if (groupId !== null) {
              db.prepare<[number, number], void>(
                "UPDATE apps SET group_id = ? WHERE id = ?",
              ).run(groupId, appId);
            }
          }
        }
      } else {
        // Active window is untracked or we're idle — close any open active session
        // so it doesn't leak time onto the previously focused app.
        console.log(`[Tracker] active window ${activeApp.exeName} not ticked: is_tracked=${appRow?.is_tracked} isIdle=${isIdle} — ending active session`);
        endActiveSession(now);
      }
    } else {
      // No focused window detected — close any open active session.
      endActiveSession(now);
    }

    // ── Build tick payload ────────────────────────────────────────────
    payload = {
      active_app:
        activeAppId && activeDisplayName
          ? {
              app_id: activeAppId,
              exe_name: activeApp!.exeName,
              display_name: activeDisplayName,
            }
          : null,
      timestamp: now,
      is_idle: isIdle,
    };

    updateTrayTooltip(activeDisplayName, isIdle);
  } catch (err) {
    console.error("[Tracker] Poll error:", err);
  }

  // ── Push tick to renderer ─────────────────────────────────────────
  // Always sent — even on error — so the renderer never gets stuck on
  // "Connecting…". On error the default payload (active_app: null) is used.
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(CHANNELS.TRACKING_TICK, payload);
    }
  });
}
