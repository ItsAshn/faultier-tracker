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
import { distance } from "fastest-levenshtein";
import {
  refreshSteamLibraryIndex,
  lookupByInstallDirNorm,
} from "./steamLibrary";

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
    linked_steam_app_id: (raw as any).linked_steam_app_id ?? null,
    icon_cache_path: raw.icon_cache_path,
    custom_image_path: raw.custom_image_path,
    first_seen: raw.first_seen,
    last_seen: raw.last_seen,
  };
}

/**
 * If the given exe path lives inside a Steam library (steamapps/common/<Folder>/),
 * check whether there is already a Steam-imported app for that folder.
 *
 * Resolution order:
 * 1. Exact match via the .acf manifest index (installDir → appId → steam: row).
 *    This handles cases like "sotgame.exe" inside "Sea Of Thieves/" perfectly.
 * 2. Fuzzy Levenshtein fallback (≤ 0.1 threshold) on display_name, same as before.
 *    Kept as safety net for games not yet installed (no .acf on disk).
 *
 * Returns the matching steam app's id + exe_name when found, null otherwise.
 */
function findSteamAppForExePath(
  exePath: string,
): { id: number; exe_name: string; display_name: string } | null {
  const steamMatch = /steamapps[\\/]common[\\/]([^\\/]+)/i.exec(exePath);
  if (!steamMatch) return null;

  const normalize = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const folderNorm = normalize(steamMatch[1]);

  const db = getDb();

  // ── 1. Exact ACF manifest lookup ──────────────────────────────────────────
  const acfEntry = lookupByInstallDirNorm(folderNorm);
  if (acfEntry) {
    const steamRow = db
      .prepare<
        [string],
        { id: number; exe_name: string; display_name: string } | undefined
      >(
        "SELECT id, exe_name, display_name FROM apps WHERE exe_name = ? AND is_steam_import = 1",
      )
      .get(`steam:${acfEntry.appId}`);
    if (steamRow) {
      console.log(
        `[Tracker] ACF match: folder "${steamMatch[1]}" → appid=${acfEntry.appId} "${steamRow.display_name}"`,
      );
      return steamRow;
    }
  }

  // ── 2. Fuzzy Levenshtein fallback ─────────────────────────────────────────
  const steamApps = db
    .prepare<
      [],
      { id: number; exe_name: string; display_name: string }
    >(
      "SELECT id, exe_name, display_name FROM apps WHERE exe_name LIKE 'steam:%' AND is_steam_import = 1",
    )
    .all();

  let best: { id: number; exe_name: string; display_name: string; dist: number } | null = null;

  for (const app of steamApps) {
    const appNorm = normalize(app.display_name);
    const maxLen = Math.max(folderNorm.length, appNorm.length);
    if (maxLen === 0) continue;
    const dist = distance(folderNorm, appNorm) / maxLen;
    if (dist <= 0.1 && (!best || dist < best.dist)) {
      best = { ...app, dist };
    }
  }

  return best ? { id: best.id, exe_name: best.exe_name, display_name: best.display_name } : null;
}

let pollTimer: NodeJS.Timeout | null = null;
let isRunning = false;

// Throttle last_seen DB writes for known apps to avoid per-tick DB churn.
// Key: app id, Value: timestamp of last last_seen write (ms).
const lastSeenWrittenAt = new Map<number, number>();
const LAST_SEEN_WRITE_INTERVAL = 60_000; // write at most once per minute

export async function startTracker(): Promise<void> {
  const machineId = getSetting("machine_id") as string;
  initSessionManager(machineId);

  // Build Steam manifest index before the first poll so suppression works
  // immediately even on first launch with existing installed games
  refreshSteamLibraryIndex();

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
  lastSeenWrittenAt.clear();
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
        // ── Steam exe suppression ──────────────────────────────────────────
        // Before inserting a new app, check if this exe lives inside a Steam
        // library folder and already has a matching steam:APPID entry. If so,
        // skip the insert entirely — the game is tracked via Steam API only.
        if (activeApp.exePath) {
          const steamEntry = findSteamAppForExePath(activeApp.exePath);
          if (steamEntry) {
            console.log(
              `[Tracker] Suppressing exe "${activeApp.exeName}" — already imported as Steam game "${steamEntry.display_name}" (${steamEntry.exe_name})`,
            );
            endActiveSession(now);
            // Touch last_seen on the steam entry so it stays "recently seen"
            db.prepare<[number, number], void>(
              "UPDATE apps SET last_seen = ? WHERE id = ?",
            ).run(now, steamEntry.id);
            // Leave payload.active_app = null and fall through to the tick push
            updateTrayTooltip(null, isIdle);
            payload = { active_app: null, timestamp: now, is_idle: isIdle };
            // Skip the rest of the active-window block
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed()) win.webContents.send(CHANNELS.TRACKING_TICK, payload);
            });
            return;
          }
        }

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

        // Update last_seen for this known app, throttled to once per minute,
        // so Gallery "Recent" sort stays accurate without per-tick DB writes.
        const lastWrite = lastSeenWrittenAt.get(appId) ?? 0;
        if (now - lastWrite >= LAST_SEEN_WRITE_INTERVAL) {
          db.prepare<[number, number], void>(
            "UPDATE apps SET last_seen = ? WHERE id = ?",
          ).run(now, appId);
          lastSeenWrittenAt.set(appId, now);
          // Notify renderer so the in-memory store reflects the fresh last_seen.
          const updatedApp = db
            .prepare<[number], RawApp>("SELECT * FROM apps WHERE id = ?")
            .get(appId);
          if (updatedApp) {
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed())
                win.webContents.send(CHANNELS.TRACKING_APP_SEEN, toAppRecord(updatedApp));
            });
          }
        }

        // Update exe_path if we now have it; if this is the first time we get
        // the path AND the app has no group yet, re-run group resolution so
        // Steam library path matching can kick in.
        if (activeApp.exePath && !appRow.exe_path) {
          console.log(`[Tracker] updating exe_path for app id=${appId}: ${activeApp.exePath}`);
          db.prepare<[string, number], void>(
            "UPDATE apps SET exe_path = ? WHERE id = ?",
          ).run(activeApp.exePath, appId);

          // Deferred Steam suppression: now that we have the path, check if
          // this app is actually a Steam game that was missed on first detection
          // (e.g. path wasn't available yet on the first tick).
          if (appRow.is_tracked !== 0) {
            const steamEntry = findSteamAppForExePath(activeApp.exePath);
            if (steamEntry && steamEntry.id !== appId) {
              console.log(
                `[Tracker] Deferred suppression: reassigning exe "${activeApp.exeName}" → Steam game "${steamEntry.display_name}"`,
              );
              // Reassign all sessions to the steam entry and delete this exe row.
              // Use a transaction so we never leave sessions pointing at a dead row.
              db.transaction(() => {
                db.prepare<[number, number], void>(
                  "UPDATE sessions SET app_id = ? WHERE app_id = ?",
                ).run(steamEntry.id, appId);
                db.prepare<[number], void>(
                  "DELETE FROM apps WHERE id = ?",
                ).run(appId);
              })();
              // Clear the in-memory last_seen tracker for the deleted app
              lastSeenWrittenAt.delete(appId);
              // Touch last_seen on the steam entry
              db.prepare<[number, number], void>(
                "UPDATE apps SET last_seen = ? WHERE id = ?",
              ).run(now, steamEntry.id);
              return; // Skip rest of tick — will resolve correctly next poll
            }
          }

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
