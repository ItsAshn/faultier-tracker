import { ipcMain, dialog, BrowserWindow, net, app } from "electron";
import * as fs from "fs";
import {
  getDb,
  getSetting,
  setSetting,
  getAllSettings,
  resetDbData,
  isDbOpen,
} from "../db/client";
import {
  extractAndCacheIcon,
  saveCustomImage,
  clearCustomImage,
  readFileAsDataUrl,
} from "../icons/iconExtractor";
import { reanalyzeGroups } from "../grouping/groupEngine";
import {
  exportData,
  exportDataCsv,
  importData,
} from "../importExport/dataTransfer";
import { importFromSteam, refreshSteamPlaytimes } from "../importExport/steamImport";
import { autoFetchSteamArtwork } from "../artwork/autoFetch";
import { searchSteamGridDB } from "../artwork/artworkProvider";
import { CHANNELS } from "@shared/channels";
import type {
  AppRecord,
  AppGroup,
  SessionSummary,
  RangeSummary,
  AppRangeSummary,
  TitleSummary,
  DayTotal,
  BucketApp,
  MergeSteamResult,
  SteamLinkSuggestion,
  ArtworkSearchResponse,
  WindowControlAction,
  InstallTypeInfo,
} from "@shared/types";
import { getMainWindow } from "../window";
import { startTracker, stopTracker } from "../tracking/tracker";
import { resetSessionState, endActiveSession } from "../tracking/sessionManager";
import { persistDb } from "../db/client";
import {
  refreshSteamLibraryIndex,
  lookupByInstallDirNorm,
  getAllAcfEntries,
} from "../tracking/steamLibrary";

function mapApp(raw: {
  id: number;
  exe_name: string;
  exe_path: string | null;
  display_name: string;
  group_id: number | null;
  is_tracked: number;
  is_steam_import: number;
  linked_steam_app_id?: number | null;
  icon_cache_path: string | null;
  custom_image_path: string | null;
  first_seen: number;
  last_seen: number;
}): AppRecord {
  return {
    id: raw.id,
    exe_name: raw.exe_name,
    exe_path: raw.exe_path,
    display_name: raw.display_name,
    group_id: raw.group_id,
    is_tracked: raw.is_tracked === 1,
    is_steam_import: raw.is_steam_import === 1,
    linked_steam_app_id: raw.linked_steam_app_id ?? null,
    icon_cache_path: null,
    custom_image_path: null,
    first_seen: raw.first_seen,
    last_seen: raw.last_seen,
  };
}

function mapGroup(raw: {
  id: number;
  name: string;
  icon_cache_path: string | null;
  custom_image_path: string | null;
  is_manual: number;
  created_at: number;
}): AppGroup {
  return {
    id: raw.id,
    name: raw.name,
    icon_cache_path: raw.icon_cache_path,
    custom_image_path: raw.custom_image_path,
    is_manual: raw.is_manual === 1,
    created_at: raw.created_at,
  };
}

// ── Steam exe deduplication helpers ──────────────────────────────────────────

/**
 * Merge a raw exe app row into its corresponding steam:APPID row.
 * - Reassigns all sessions from exeAppId → steamAppId
 * - Deletes the exe app row
 * - Refreshes Steam playtime for the target app (uses the Steam API if credentials exist)
 *
 * The Steam API playtime is the source of truth so we overwrite local tracked
 * time by creating a corrective session if needed.  The actual playtime
 * correction is handled by the next `refreshSteamPlaytimes` call; here we
 * only do the structural merge so the data is consistent.
 */
export function mergeSteamExeDuplicate(
  exeAppId: number,
  steamAppId: number,
): MergeSteamResult {
  const db = getDb();

  // Verify both rows exist
  const exeRow = db
    .prepare<[number], { id: number; exe_name: string }>(
      "SELECT id, exe_name FROM apps WHERE id = ?",
    )
    .get(exeAppId);
  if (!exeRow) {
    return { success: false, error: `Exe app id=${exeAppId} not found` };
  }

  const steamRow = db
    .prepare<[number], { id: number; exe_name: string; display_name: string }>(
      "SELECT id, exe_name, display_name FROM apps WHERE id = ? AND is_steam_import = 1",
    )
    .get(steamAppId);
  if (!steamRow) {
    return {
      success: false,
      error: `Steam app id=${steamAppId} not found or is not a Steam import`,
    };
  }

  try {
    db.transaction(() => {
      // Reassign all sessions from the exe row to the steam row
      db.prepare<[number, number], void>(
        "UPDATE sessions SET app_id = ? WHERE app_id = ?",
      ).run(steamAppId, exeAppId);

      // Delete the raw exe row (sessions ON DELETE CASCADE would handle it
      // but we already re-pointed them so this is safe)
      db.prepare<[number], void>("DELETE FROM apps WHERE id = ?").run(exeAppId);
    })();

    console.log(
      `[Merge] Merged exe app id=${exeAppId} (${exeRow.exe_name}) → steam app id=${steamAppId} (${steamRow.exe_name} "${steamRow.display_name}")`,
    );

    // Fire-and-forget: refresh Steam playtime so the merged data is accurate
    const apiKey = getSetting("steam_api_key") as string | null;
    const steamId = getSetting("steam_id") as string | null;
    if (apiKey && steamId) {
      refreshSteamPlaytimes(apiKey, steamId).catch((err) =>
        console.error("[Merge] Steam refresh after merge failed:", err),
      );
    }

    return { success: true };
  } catch (err) {
    console.error("[Merge] Failed to merge Steam exe duplicate:", err);
    return { success: false, error: String(err) };
  }
}

/**
 * Scan all non-Steam apps that have a steamapps/common path and check them
 * against the manifest index.  Called once at startup.
 *
 * - If a high-confidence match is found (exact installDir match from .acf):
 *   auto-merge silently.
 * - If a lower-confidence match is found (Levenshtein ≤ 0.25, no exact ACF match):
 *   send APPS_STEAM_LINK_SUGGESTED to prompt the user.
 */
export async function runStartupSteamDuplicateScan(): Promise<void> {
  const db = getDb();

  // Make sure the manifest index is current
  refreshSteamLibraryIndex();

  // Find all non-Steam apps that have a path inside a steamapps/common folder
  // and don't already have a linked_steam_app_id set
  const candidates = db
    .prepare<
      [],
      {
        id: number;
        exe_name: string;
        display_name: string;
        exe_path: string;
        linked_steam_app_id: number | null;
      }
    >(
      `SELECT id, exe_name, display_name, exe_path, linked_steam_app_id
       FROM apps
       WHERE is_steam_import = 0
         AND exe_path IS NOT NULL
         AND exe_path LIKE '%steamapps%common%'
         AND linked_steam_app_id IS NULL`,
    )
    .all();

  if (candidates.length === 0) return;

  // Lazy-load distance function to keep import cycle clean
  const { distance } = await import("fastest-levenshtein");

  const normalize = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Get all steam: app rows for fuzzy fallback
  const steamApps = db
    .prepare<
      [],
      { id: number; exe_name: string; display_name: string }
    >(
      "SELECT id, exe_name, display_name FROM apps WHERE is_steam_import = 1",
    )
    .all();

  for (const cand of candidates) {
    const steamFolderMatch =
      /steamapps[\\/]common[\\/]([^\\/]+)/i.exec(cand.exe_path);
    if (!steamFolderMatch) continue;

    const folderName = steamFolderMatch[1];
    const folderNorm = normalize(folderName);

    // ── Try exact ACF manifest lookup first ────────────────────────────
    const acfEntry = lookupByInstallDirNorm(folderNorm);
    if (acfEntry) {
      // Exact match — find the steam: row for this appId
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
          `[StartupScan] Auto-merging "${cand.exe_name}" → "${steamRow.display_name}" (ACF exact match, appid=${acfEntry.appId})`,
        );
        mergeSteamExeDuplicate(cand.id, steamRow.id);
        // Notify renderer to reload apps
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send(CHANNELS.APPS_ARTWORK_UPDATED);
          }
        });
        continue;
      }
    }

    // ── Fall back to fuzzy Levenshtein matching ────────────────────────
    // Lower threshold than tracker (0.25 vs 0.1) since we're prompting the user
    const scored: Array<{
      id: number;
      exe_name: string;
      display_name: string;
      dist: number;
    }> = [];

    for (const app of steamApps) {
      const appNorm = normalize(app.display_name);
      const maxLen = Math.max(folderNorm.length, appNorm.length);
      if (maxLen === 0) continue;
      const dist = distance(folderNorm, appNorm) / maxLen;
      if (dist <= 0.25) {
        scored.push({ ...app, dist });
      }
    }

    if (scored.length === 0) continue;

    // Sort by distance (best first), take top 3
    scored.sort((a, b) => a.dist - b.dist);
    const top3 = scored.slice(0, 3);

    // Check if user hasn't dismissed this suggestion already
    const ignoredKey = `steam_link_ignored_${cand.id}`;
    const ignored = getSetting(ignoredKey);
    if (ignored) continue;

    // Build full AppRecord rows for the suggestion payload
    const exeRow = db
      .prepare<[number], Record<string, unknown>>("SELECT * FROM apps WHERE id = ?")
      .get(cand.id);
    const candidateRows = top3
      .map((c) =>
        db
          .prepare<[number], Record<string, unknown>>("SELECT * FROM apps WHERE id = ?")
          .get(c.id),
      )
      .filter(Boolean) as Record<string, unknown>[];

    if (!exeRow) continue;

    const suggestion: SteamLinkSuggestion = {
      exeApp: mapApp(exeRow as Parameters<typeof mapApp>[0]),
      candidates: candidateRows.map((r) => mapApp(r as Parameters<typeof mapApp>[0])),
    };

    console.log(
      `[StartupScan] Suggesting link for "${cand.exe_name}" → candidates: ${top3.map((c) => c.display_name).join(", ")}`,
    );

    // Push to all renderer windows
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(CHANNELS.APPS_STEAM_LINK_SUGGESTED, suggestion);
      }
    });
  }
}

export function registerIpcHandlers(): void {
  // ── Apps ─────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.APPS_GET_ALL, (): AppRecord[] => {
    const db = getDb();
    interface RawAppRow {
      id: number;
      exe_name: string;
      exe_path: string | null;
      display_name: string;
      group_id: number | null;
      is_tracked: number;
      is_steam_import: number;
      icon_cache_path: string | null;
      custom_image_path: string | null;
      first_seen: number;
      last_seen: number;
    }
    const rows = db.prepare<[], RawAppRow>("SELECT id, exe_name, exe_path, display_name, group_id, is_tracked, is_steam_import, icon_cache_path, custom_image_path, first_seen, last_seen FROM apps ORDER BY display_name COLLATE NOCASE").all();
    return rows.map(mapApp);
  });

  ipcMain.handle(
    CHANNELS.APPS_UPDATE,
    (_e, patch: Partial<AppRecord> & { id: number }): void => {
      const db = getDb();
      const {
        id,
        display_name,
        group_id,
      } = patch;
      const setClauses: string[] = [];
      const params: unknown[] = [];
      if (display_name !== undefined) {
        setClauses.push("display_name = ?");
        params.push(display_name);
      }
      if (group_id !== undefined) {
        setClauses.push("group_id = ?");
        params.push(group_id);
      }
      if (setClauses.length === 0) return;
      params.push(id);
      db.prepare(`UPDATE apps SET ${setClauses.join(", ")} WHERE id = ?`).run(
        ...params,
      );
    },
  );

  ipcMain.handle(
    CHANNELS.APPS_SET_TRACKED,
    async (_e, id: number, tracked: boolean): Promise<boolean> => {
      const db = getDb();
      try {
        db.prepare<[number, number]>(
          "UPDATE apps SET is_tracked = ? WHERE id = ?",
        ).run(tracked ? 1 : 0, id);
        // When an app is disabled, close any open active sessions immediately
        // so time stops accruing — don't wait for the next poll tick.
        if (!tracked) {
          const now = Date.now();
          console.log(`[IPC] APPS_SET_TRACKED: app id=${id} disabled — closing open sessions`);
          endActiveSession(now);
        }
        return true;
      } catch (err) {
        console.error('[IPC] APPS_SET_TRACKED error:', err);
        throw err;
      }
    },
  );

  ipcMain.handle(
    CHANNELS.APPS_SET_GROUP,
    (_e, id: number, groupId: number | null): void => {
      const db = getDb();
      db.prepare<[number | null, number]>(
        "UPDATE apps SET group_id = ? WHERE id = ?",
      ).run(groupId, id);
    },
  );

  ipcMain.handle(
    CHANNELS.APPS_SET_GROUP_BATCH,
    (_e, appIds: number[], groupId: number | null): void => {
      const db = getDb();
      const updateMany = db.transaction(() => {
        const stmt = db.prepare<[number | null, number]>(
          "UPDATE apps SET group_id = ? WHERE id = ?",
        );
        for (const id of appIds) {
          stmt.run(groupId, id);
        }
      });
      updateMany();
    },
  );

  // ── Groups ────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.GROUPS_GET_ALL, (): AppGroup[] => {
    const db = getDb();
    interface RawGroupRow {
      id: number;
      name: string;
      icon_cache_path: string | null;
      custom_image_path: string | null;
      is_manual: number;
      created_at: number;
    }
    const rows = db.prepare<[], RawGroupRow>("SELECT id, name, icon_cache_path, custom_image_path, is_manual, created_at FROM app_groups ORDER BY name COLLATE NOCASE").all();
    return rows.map(mapGroup);
  });

  ipcMain.handle(CHANNELS.GROUPS_CREATE, (_e, name: string): AppGroup => {
    const db = getDb();
    const now = Date.now();
    const result = db
      .prepare<
        [string, number]
      >("INSERT INTO app_groups (name, is_manual, created_at) VALUES (?, 1, ?)")
      .run(name, now);
    const id = result.lastInsertRowid as number;
    return {
      id,
      name,
      icon_cache_path: null,
      custom_image_path: null,
      is_manual: true,
      created_at: now,
    };
  });

  ipcMain.handle(
    CHANNELS.GROUPS_UPDATE,
    (_e, patch: Partial<AppGroup> & { id: number }): void => {
      const db = getDb();
      const { id, name } = patch;
      const setClauses: string[] = [];
      const params: unknown[] = [];
      if (name !== undefined) {
        setClauses.push("name = ?");
        params.push(name);
      }
      if (setClauses.length === 0) return;
      params.push(id);
      db.prepare(
        `UPDATE app_groups SET ${setClauses.join(", ")} WHERE id = ?`,
      ).run(...params);
    },
  );

  ipcMain.handle(CHANNELS.GROUPS_DELETE, (_e, id: number): void => {
    const db = getDb();
    db.prepare<[number]>("DELETE FROM app_groups WHERE id = ?").run(id);
  });

  ipcMain.handle(CHANNELS.GROUPS_REANALYZE, async (): Promise<void> => {
    await reanalyzeGroups();
  });

  // ── System ─────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.SYSTEM_GET_INSTALL_TYPE, (): InstallTypeInfo => {
    if (process.platform === "win32") {
      return { canAutoUpdate: true, installType: "windows" };
    }
    if (process.env.APPIMAGE) {
      return { canAutoUpdate: true, installType: "appimage" };
    }
    return { canAutoUpdate: false, installType: "system-package" };
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_RANGE,
    (
      _e,
      from: number,
      to: number,
      groupBy: "hour" | "day" = "day",
    ): RangeSummary => {
      const db = getDb();
      const now = Date.now();

      // Query A: per-app aggregated totals via SQL — avoids loading all raw rows into JS
      // and eliminates the separate full apps-table fetch.
      const appSummaries = db
        .prepare<
          [number, number, number, number, number],
          {
            app_id: number;
            exe_name: string;
            display_name: string;
            group_id: number | null;
            active_ms: number;
          }
        >(
          `SELECT a.id AS app_id, a.exe_name, a.display_name, a.group_id,
                  SUM(MAX(0, MIN(COALESCE(s.ended_at, ?), ?) - MAX(s.started_at, ?))) AS active_ms
           FROM sessions s
           JOIN apps a ON a.id = s.app_id
           WHERE s.session_type = 'active'
             AND s.started_at < ?
             AND (s.ended_at IS NULL OR s.ended_at > ?)
           GROUP BY s.app_id
           ORDER BY active_ms DESC`,
        )
        .all(now, to, from, to, from);

      // Query B: chart points bucketed in SQL — no JS date-formatting loop
      const dateFmt = groupBy === "hour"
        ? "%Y-%m-%d %H:00"
        : "%Y-%m-%d";
      const chartPoints = db
        .prepare<
          [string, number, number, number, number, number, number],
          { date: string; active_ms: number }
        >(
          `SELECT strftime(?, MAX(s.started_at, ?) / 1000, 'unixepoch', 'localtime') AS date,
                  SUM(MAX(0, MIN(COALESCE(s.ended_at, ?), ?) - MAX(s.started_at, ?))) AS active_ms
           FROM sessions s
           WHERE s.session_type = 'active'
             AND s.started_at < ?
             AND (s.ended_at IS NULL OR s.ended_at > ?)
           GROUP BY date
           ORDER BY date`,
        )
        .all(dateFmt, from, now, to, from, to, from);

      const totalActive = appSummaries.reduce((acc, a) => acc + a.active_ms, 0);

      return {
        from,
        to,
        total_active_ms: totalActive,
        top_app: appSummaries[0] ?? null,
        apps: appSummaries,
        chart_points: chartPoints,
      };
    },
  );

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_APP_RANGE,
    (
      _e,
      id: number,
      from: number,
      to: number,
      groupBy: "hour" | "day",
      isGroup: boolean,
    ): AppRangeSummary => {
      const db = getDb();
      const now = Date.now();

      // Timezone offset in ms so SQLite strftime buckets match local time.
      // getTimezoneOffset() returns minutes west of UTC (negative = east).
      const tzOffsetMs = new Date().getTimezoneOffset() * -60_000;

      // strftime format string — produce labels matching the renderer's fmtLabel()
      const dateFmt = groupBy === "hour" ? "%Y-%m-%d %H:00" : "%Y-%m-%d";

      // App-id filter — either a single app or all members of a group.
      const appFilter = isGroup
        ? "s.app_id IN (SELECT id FROM apps WHERE group_id = ?)"
        : "s.app_id = ?";

      // CTE clips each session to [from, to] once; subsequent queries reuse it.
      const cteClipped = `
        WITH clipped AS (
          SELECT s.app_id,
                 MAX(s.started_at, ?) AS cs,
                 MIN(COALESCE(s.ended_at, ?), ?) AS ce
          FROM sessions s
          WHERE s.session_type = 'active'
            AND ${appFilter}
            AND s.started_at < ?
            AND (s.ended_at IS NULL OR s.ended_at > ?)
        )`;

      // Params order: from, now, to, id, to, from
      const baseParams: [number, number, number, number, number, number] = [
        from, now, to, id, to, from,
      ];

      // ── Totals ──────────────────────────────────────────────────────────────
      const totalsRow = db
        .prepare<
          typeof baseParams,
          { active_ms: number; session_count: number }
        >(
          `${cteClipped}
           SELECT COALESCE(SUM(ce - cs), 0) AS active_ms,
                  COUNT(*)                  AS session_count
           FROM clipped
           WHERE ce > cs`,
        )
        .get(...baseParams)!;

      // ── Chart buckets ────────────────────────────────────────────────────────
      const chartRows = db
        .prepare<
          [...typeof baseParams, number],
          { date: string; active_ms: number }
        >(
          `${cteClipped}
           SELECT strftime('${dateFmt}', (cs + ?) / 1000, 'unixepoch') AS date,
                  SUM(ce - cs)                                          AS active_ms
           FROM clipped
           WHERE ce > cs
           GROUP BY date
           ORDER BY date`,
        )
        .all(...baseParams, tzOffsetMs);

      // ── Member summaries (groups only) ───────────────────────────────────────
      let member_summaries: SessionSummary[] = [];
      if (isGroup) {
        // Extra trailing `id` binds the outer WHERE a.group_id = ?
        const memberParams: [...typeof baseParams, number] = [...baseParams, id];
        member_summaries = db
          .prepare<
            typeof memberParams,
            {
              app_id: number;
              exe_name: string;
              display_name: string;
              active_ms: number;
            }
          >(
            `${cteClipped}
             SELECT a.id           AS app_id,
                    a.exe_name,
                    a.display_name,
                    COALESCE(SUM(CASE WHEN c.ce > c.cs THEN c.ce - c.cs ELSE 0 END), 0) AS active_ms
             FROM apps a
             LEFT JOIN clipped c ON c.app_id = a.id
             WHERE a.group_id = ?
             GROUP BY a.id
             ORDER BY active_ms DESC`,
          )
          .all(...memberParams)
          .map((r) => ({ ...r, group_id: id }));
      }

      return {
        active_ms: totalsRow.active_ms,
        session_count: totalsRow.session_count,
        chart_points: chartRows,
        member_summaries,
      };
    },
  );

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_TITLES,
    (
      _e,
      appId: number,
      from: number,
      to: number,
      isGroup: boolean,
    ): TitleSummary[] => {
      const db = getDb();
      const rows = isGroup
        ? db
            .prepare<
              [number, number, number],
              { window_title: string; started_at: number; ended_at: number }
            >(
              `SELECT window_title, started_at, ended_at
             FROM sessions
             WHERE app_id IN (SELECT id FROM apps WHERE group_id = ?)
               AND session_type = 'active'
               AND window_title IS NOT NULL AND window_title != ''
               AND started_at >= ? AND ended_at IS NOT NULL AND ended_at <= ?
             ORDER BY started_at DESC`,
            )
            .all(appId, from, to)
        : db
            .prepare<
              [number, number, number],
              { window_title: string; started_at: number; ended_at: number }
            >(
              `SELECT window_title, started_at, ended_at
             FROM sessions
             WHERE app_id = ?
               AND session_type = 'active'
               AND window_title IS NOT NULL AND window_title != ''
               AND started_at >= ? AND ended_at IS NOT NULL AND ended_at <= ?
             ORDER BY started_at DESC`,
            )
            .all(appId, from, to);

      const titleMap = new Map<
        string,
        { duration_ms: number; last_seen: number }
      >();
      for (const r of rows) {
        const dur = r.ended_at - r.started_at;
        const existing = titleMap.get(r.window_title);
        if (existing) {
          existing.duration_ms += dur;
          if (r.ended_at > existing.last_seen) existing.last_seen = r.ended_at;
        } else {
          titleMap.set(r.window_title, {
            duration_ms: dur,
            last_seen: r.ended_at,
          });
        }
      }

      return Array.from(titleMap.entries())
        .map(([window_title, { duration_ms, last_seen }]) => ({
          window_title,
          duration_ms,
          last_seen,
        }))
        .sort((a, b) => b.duration_ms - a.duration_ms)
        .slice(0, 50);
    },
  );

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_DAILY_TOTALS,
    (_e, from: number, to: number): DayTotal[] => {
      const db = getDb();
      console.log(`[IPC] getDailyTotals from=${new Date(from).toISOString()} to=${new Date(to).toISOString()}`);
      const now = Date.now();
      const rows = db
        .prepare<[number, number, number, number, number, number], { date: string; active_ms: number }>(
          `SELECT strftime('%Y-%m-%d', MAX(started_at, ?)/1000, 'unixepoch', 'localtime') AS date,
                  SUM(MAX(0, MIN(COALESCE(ended_at, ?), ?) - MAX(started_at, ?))) AS active_ms
           FROM sessions
           WHERE session_type = 'active'
             AND started_at < ?
             AND (ended_at IS NULL OR ended_at > ?)
           GROUP BY date
           ORDER BY date`,
        )
        .all(from, now, to, from, to, from);
      console.log(`[IPC] getDailyTotals -> ${rows.length} day(s) returned`);
      return rows;
    },
  );

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_BUCKET_APPS,
    (_e, from: number, to: number): BucketApp[] => {
      const db = getDb();
      console.log(`[IPC] getBucketApps from=${new Date(from).toISOString()} to=${new Date(to).toISOString()}`);
      const now = Date.now();
      const rows = db
        .prepare<
          [number, number, number, number, number],
          { app_id: number; display_name: string; active_ms: number }
        >(
          `SELECT s.app_id,
                  a.display_name,
                  SUM(MAX(0, MIN(COALESCE(s.ended_at, ?), ?) - MAX(s.started_at, ?))) AS active_ms
           FROM sessions s
           JOIN apps a ON a.id = s.app_id
           WHERE s.session_type = 'active'
             AND s.started_at < ?
             AND (s.ended_at IS NULL OR s.ended_at > ?)
           GROUP BY s.app_id
           ORDER BY active_ms DESC
           LIMIT 5`,
        )
        .all(now, to, from, to, from);
      console.log(`[IPC] getBucketApps -> ${rows.length} app(s):`, rows.map(r => `${r.display_name}=${Math.round(r.active_ms/60000)}m`).join(', '));
      return rows;
    },
  );

  ipcMain.handle(CHANNELS.SESSIONS_CLEAR_ALL, (): void => {
    const db = getDb();
    console.log('[IPC] SESSIONS_CLEAR_ALL: deleting all sessions from database');
    db.prepare("DELETE FROM sessions").run();
    // Discard stale in-memory sessions so the tracker starts fresh next tick
    resetSessionState();
    // Flush the now-empty sessions table to disk immediately
    persistDb();
    // Tell the renderer to reload all data
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.DATA_CLEARED);
    });
    console.log('[IPC] SESSIONS_CLEAR_ALL: complete');
  });

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.SETTINGS_GET_ALL, () => getAllSettings());

  ipcMain.handle(
    CHANNELS.SETTINGS_SET,
    (_e, key: string, value: unknown): void => {
      setSetting(key, value);
      // Restart tracker if poll interval changed
      if (key === "poll_interval_ms") {
        stopTracker();
        startTracker();
      }
      // Sync OS login item if startup setting changed (packaged app only)
      if (key === "launch_at_startup" && app.isPackaged) {
        const enable = value === true || value === "true";
        app.setLoginItemSettings({
          openAtLogin: enable,
        });
      }
    },
  );

  // ── Icons ─────────────────────────────────────────────────────────────────

  // ── Shared icon resolution helpers ───────────────────────────────────────

  async function resolveAppIcon(appId: number): Promise<string | null> {
    const db = getDb();
    const row = db
      .prepare<
        [number],
        {
          exe_path: string | null;
          icon_cache_path: string | null;
          custom_image_path: string | null;
        }
      >("SELECT exe_path, icon_cache_path, custom_image_path FROM apps WHERE id = ?")
      .get(appId);
    if (!row) {
      console.warn(`[Icon] resolveAppIcon: no app found for id=${appId}`);
      return null;
    }

    const customDataUrl = readFileAsDataUrl(row.custom_image_path);
    if (customDataUrl) {
      console.log(`[Icon] app ${appId}: returning custom image (${row.custom_image_path})`);
      return customDataUrl;
    }

    const cachedDataUrl = readFileAsDataUrl(row.icon_cache_path);
    if (cachedDataUrl) {
      console.log(`[Icon] app ${appId}: returning cached icon (${row.icon_cache_path})`);
      return cachedDataUrl;
    }

    if (row.exe_path) {
      console.log(`[Icon] app ${appId}: extracting icon from exe (${row.exe_path})`);
      const fsPath = await extractAndCacheIcon(appId, row.exe_path);
      // DB may have been closed while we awaited the icon extraction
      if (!isDbOpen()) {
        console.warn(`[Icon] app ${appId}: DB closed during icon extraction, skipping cache write`);
        return fsPath ? readFileAsDataUrl(fsPath) : null;
      }
      if (fsPath) {
        db.prepare<[string, number]>(
          "UPDATE apps SET icon_cache_path = ? WHERE id = ?",
        ).run(fsPath, appId);
        console.log(`[Icon] app ${appId}: icon extracted and cached at ${fsPath}`);
        return readFileAsDataUrl(fsPath);
      }
      console.warn(`[Icon] app ${appId}: icon extraction failed for exe=${row.exe_path}`);
    } else {
      console.log(`[Icon] app ${appId}: no exe_path, no icon available`);
    }
    return null;
  }

  async function resolveGroupIcon(groupId: number): Promise<string | null> {
    const db = getDb();
    const group = db
      .prepare<
        [number],
        { icon_cache_path: string | null; custom_image_path: string | null }
      >("SELECT icon_cache_path, custom_image_path FROM app_groups WHERE id = ?")
      .get(groupId);
    if (!group) {
      console.warn(`[Icon] resolveGroupIcon: no group found for id=${groupId}`);
      return null;
    }

    const customDataUrl = readFileAsDataUrl(group.custom_image_path);
    if (customDataUrl) {
      console.log(`[Icon] group ${groupId}: returning custom image`);
      return customDataUrl;
    }

    const cachedDataUrl = readFileAsDataUrl(group.icon_cache_path);
    if (cachedDataUrl) {
      console.log(`[Icon] group ${groupId}: returning cached icon`);
      return cachedDataUrl;
    }

    const member = db
      .prepare<
        [number],
        { id: number; exe_path: string | null; icon_cache_path: string | null }
      >("SELECT id, exe_path, icon_cache_path FROM apps WHERE group_id = ? AND exe_path IS NOT NULL LIMIT 1")
      .get(groupId);

    if (member) {
      const memberDataUrl = readFileAsDataUrl(member.icon_cache_path);
      if (memberDataUrl) {
        console.log(`[Icon] group ${groupId}: returning member app ${member.id} cached icon`);
        return memberDataUrl;
      }

      if (member.exe_path) {
        console.log(`[Icon] group ${groupId}: extracting icon from member app ${member.id} (${member.exe_path})`);
        const fsPath = await extractAndCacheIcon(member.id, member.exe_path);
        // DB may have been closed while we awaited the icon extraction
        if (!isDbOpen()) {
          console.warn(`[Icon] group ${groupId}: DB closed during icon extraction, skipping cache write`);
          return fsPath ? readFileAsDataUrl(fsPath) : null;
        }
        if (fsPath) {
          db.prepare<[string, number]>(
            "UPDATE apps SET icon_cache_path = ? WHERE id = ?",
          ).run(fsPath, member.id);
          db.prepare<[string, number]>(
            "UPDATE app_groups SET icon_cache_path = ? WHERE id = ?",
          ).run(fsPath, groupId);
          console.log(`[Icon] group ${groupId}: icon extracted and cached at ${fsPath}`);
          return readFileAsDataUrl(fsPath);
        }
        console.warn(`[Icon] group ${groupId}: icon extraction failed for member ${member.id}`);
      }
    } else {
      console.log(`[Icon] group ${groupId}: no member with exe_path found, no icon available`);
    }
    return null;
  }

  ipcMain.handle(
    CHANNELS.ICONS_GET_FOR_APP,
    (_e, appId: number): Promise<string | null> => resolveAppIcon(appId),
  );

  ipcMain.handle(
    CHANNELS.ICONS_GET_FOR_GROUP,
    (_e, groupId: number): Promise<string | null> => resolveGroupIcon(groupId),
  );

  ipcMain.handle(
    CHANNELS.ICONS_GET_BATCH,
    async (
      _e,
      requests: Array<{ id: number; isGroup: boolean }>,
    ): Promise<Record<string, string | null>> => {
      // Process in batches of 5 to avoid saturating the file system with
      // simultaneous VBScript/PowerShell icon extraction processes.
      const CONCURRENCY = 5;
      const entries: Array<readonly [string, string | null]> = [];

      for (let i = 0; i < requests.length; i += CONCURRENCY) {
        const chunk = requests.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(
          chunk.map(async (req) => {
            const key = `${req.isGroup ? "g" : "a"}:${req.id}`;
            try {
              const icon = req.isGroup
                ? await resolveGroupIcon(req.id)
                : await resolveAppIcon(req.id);
              return [key, icon] as const;
            } catch {
              return [key, null] as const;
            }
          }),
        );
        entries.push(...chunkResults);
      }

      return Object.fromEntries(entries);
    },
  );

  ipcMain.handle(
    CHANNELS.ICONS_SET_CUSTOM,
    async (
      _e,
      id: number,
      base64: string,
      isGroup = false,
    ): Promise<string> => {
      const db = getDb();
      const fsPath = saveCustomImage(id, base64);
      if (isGroup) {
        db.prepare<[string, number]>(
          "UPDATE app_groups SET custom_image_path = ? WHERE id = ?",
        ).run(fsPath, id);
      } else {
        db.prepare<[string, number]>(
          "UPDATE apps SET custom_image_path = ? WHERE id = ?",
        ).run(fsPath, id);
      }
      // Return the original base64 — no need to re-read the file we just wrote
      return base64;
    },
  );

  ipcMain.handle(
    CHANNELS.ICONS_FETCH_URL,
    async (
      _e,
      id: number,
      imgUrl: string,
      isGroup = false,
    ): Promise<string | null> => {
      const db = getDb();
      const MAX_ATTEMPTS = 3;
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: (() => { try { return new URL(imgUrl).origin } catch { return '' } })(),
      };

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          console.log(`[Icons] fetchUrl attempt ${attempt}/${MAX_ATTEMPTS} id=${id} url=${imgUrl}`);
          const res = await net.fetch(imgUrl, { headers });

          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("retry-after") ?? 2) * 1000;
            const delay = Math.max(retryAfter, attempt * 1000);
            console.warn(`[Icons] fetchUrl rate-limited (429), waiting ${delay}ms before retry`);
            if (attempt < MAX_ATTEMPTS) {
              await new Promise<void>((r) => setTimeout(r, delay));
              continue;
            }
            console.error('[Icons] fetchUrl gave up after rate-limit retries');
            return null;
          }

          if (!res.ok) {
            console.error(`[Icons] fetchUrl HTTP ${res.status} for url=${imgUrl}`);
            return null;
          }

          const contentType = res.headers.get("content-type") ?? "";
          const mimeFromHeader = contentType.split(";")[0].trim();

          // Fallback: detect MIME from URL extension when CDN omits Content-Type
          const urlExt = imgUrl.split("?")[0].split(".").pop()?.toLowerCase() ?? "";
          const extMimeMap: Record<string, string> = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
            png: "image/png",
          };
          const mime =
            mimeFromHeader && mimeFromHeader.startsWith("image/")
              ? mimeFromHeader
              : extMimeMap[urlExt] ?? "image/png";

          const extMap: Record<string, string> = {
            "image/jpeg": "jpg",
            "image/gif": "gif",
            "image/webp": "webp",
            "image/svg+xml": "svg",
          };
          const ext = extMap[mime] ?? "png";

          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength === 0) {
            console.error(`[Icons] fetchUrl empty response body for url=${imgUrl}`);
            return null;
          }
          const base64 = `data:${mime};base64,${buf.toString("base64")}`;

          const fsPath = saveCustomImage(id, base64, ext);
          console.log(`[Icons] fetchUrl saved to ${fsPath} (${buf.byteLength} bytes, ${mime})`);

          if (isGroup) {
            db.prepare<[string, number]>(
              "UPDATE app_groups SET custom_image_path = ? WHERE id = ?",
            ).run(fsPath, id);
          } else {
            db.prepare<[string, number]>(
              "UPDATE apps SET custom_image_path = ? WHERE id = ?",
            ).run(fsPath, id);
          }
          return base64;
        } catch (err) {
          console.error(`[Icons] fetchUrl attempt ${attempt} threw:`, err);
          if (attempt < MAX_ATTEMPTS) {
            await new Promise<void>((r) => setTimeout(r, attempt * 500));
          }
        }
      }

      console.error(`[Icons] fetchUrl failed after ${MAX_ATTEMPTS} attempts for url=${imgUrl}`);
      return null;
    },
  );

  ipcMain.handle(
    CHANNELS.ICONS_CLEAR_CUSTOM,
    (_e, id: number, isGroup = false): void => {
      const db = getDb();
      clearCustomImage(id);
      if (isGroup) {
        db.prepare<[number]>(
          "UPDATE app_groups SET custom_image_path = NULL WHERE id = ?",
        ).run(id);
      } else {
        db.prepare<[number]>(
          "UPDATE apps SET custom_image_path = NULL WHERE id = ?",
        ).run(id);
      }
    },
  );

  // ── Artwork search ────────────────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.ARTWORK_SEARCH,
    async (
      _e,
      query: string,
      type?: string,
    ): Promise<ArtworkSearchResponse> => {
      const apiKey = getSetting("steamgriddb_api_key") as string | null;
      if (!apiKey) return { results: [], error: "no_key" };
      try {
        const results = await searchSteamGridDB(
          query,
          apiKey,
          (type as "grids" | "heroes" | "logos" | "icons") ?? "grids",
        );
        return { results };
      } catch (err) {
        return { results: [], error: (err as Error).message };
      }
    },
  );

  // ── Data transfer ─────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.DATA_EXPORT, () => exportData());
  ipcMain.handle(CHANNELS.DATA_EXPORT_CSV, () => exportDataCsv());
  ipcMain.handle(CHANNELS.DATA_IMPORT, () => importData());
  ipcMain.handle(
    CHANNELS.DATA_STEAM_IMPORT,
    async (_e, apiKey: string, steamId: string) => {
      const result = await importFromSteam(apiKey, steamId);
      if (result.gamesImported > 0) {
        // Fire-and-forget background artwork fetch for newly imported games
        autoFetchSteamArtwork().catch(console.error);
        // Run duplicate scan so any existing exe rows for these new steam: games
        // are merged automatically or surfaced to the user
        runStartupSteamDuplicateScan().catch(console.error);
      }
      return result;
    },
  );

  ipcMain.handle(CHANNELS.DATA_STEAM_REFRESH, async () => {
    const apiKey = getSetting("steam_api_key") as string | null;
    const steamId = getSetting("steam_id") as string | null;
    if (!apiKey || !steamId) {
      return { updated: 0, totalDeltaMs: 0, error: "no_credentials" };
    }
    try {
      const result = await refreshSteamPlaytimes(apiKey, steamId);
      // After a Steam refresh, run the duplicate scan in case new games were
      // added that now match previously unresolved exe rows
      runStartupSteamDuplicateScan().catch(console.error);
      return result;
    } catch (err) {
      console.error("[IPC] DATA_STEAM_REFRESH failed:", err);
      throw err;
    }
  });

  // ── Steam exe merge ───────────────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.APPS_MERGE_STEAM,
    (_e, exeAppId: number, steamAppId: number): MergeSteamResult => {
      const result = mergeSteamExeDuplicate(exeAppId, steamAppId);
      if (result.success) {
        // Reload apps in renderer
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send(CHANNELS.APPS_ARTWORK_UPDATED);
          }
        });
      }
      return result;
    },
  );

  ipcMain.handle(CHANNELS.DATA_RESET_ALL, async (): Promise<void> => {
    console.log('[IPC] DATA_RESET_ALL: stopping tracker, resetting all data, restarting tracker');
    stopTracker();
    // Clear in-memory session state BEFORE wiping the DB so closeAllSessions
    // (called inside stopTracker path) doesn't try to UPDATE now-gone rows
    resetSessionState();
    resetDbData();
    // Flush the freshly-seeded empty DB to disk immediately
    persistDb();
    await startTracker();
    // Tell the renderer to reload apps, groups, settings, and session data
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send(CHANNELS.DATA_CLEARED);
    });
    console.log('[IPC] DATA_RESET_ALL: complete');
  });

  // ── Window control ────────────────────────────────────────────────────────

  ipcMain.on(CHANNELS.WINDOW_CONTROL, (_e, action: WindowControlAction) => {
    // Restart doesn't need a window reference — handle it first.
    if (action === "restart") {
      app.relaunch();
      app.quit();
      return;
    }
    const win = getMainWindow();
    if (!win) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize")
      win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.hide();
  });
}
