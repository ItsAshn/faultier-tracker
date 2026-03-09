import { ipcMain, dialog, BrowserWindow, net, app } from "electron";
import {
  getDb,
  getSetting,
  setSetting,
  getAllSettings,
  resetDbData,
} from "../db/client";
import {
  extractAndCacheIcon,
  saveCustomImage,
  clearCustomImage,
  readFileAsDataUrl,
} from "../icons/iconExtractor";
import { reanalyzeGroups, invalidateGroupCache } from "../grouping/groupEngine";
import {
  exportData,
  exportDataCsv,
  importData,
} from "../importExport/dataTransfer";
import { importFromSteam } from "../importExport/steamImport";
import { autoFetchSteamArtwork } from "../artwork/autoFetch";
import { searchSteamGridDB } from "../artwork/artworkProvider";
import { CHANNELS } from "@shared/channels";
import type {
  AppRecord,
  AppGroup,
  SessionSummary,
  RangeSummary,
  ChartDataPoint,
  WindowControlAction,
  ArtworkSearchResponse,
  AppRangeSummary,
  TitleSummary,
  DayTotal,
  BucketApp,
} from "@shared/types";
import { getMainWindow } from "../window";
import { startTracker, stopTracker } from "../tracking/tracker";
import { resetSessionState, endRunningSession, endActiveSession } from "../tracking/sessionManager";
import { persistDb } from "../db/client";

function mapApp(raw: {
  id: number;
  exe_name: string;
  exe_path: string | null;
  display_name: string;
  group_id: number | null;
  is_tracked: number;
  icon_cache_path: string | null;
  custom_image_path: string | null;
  description: string;
  notes: string;
  tags: string;
  first_seen: number;
  last_seen: number;
  daily_goal_ms: number | null;
}): AppRecord {
  return {
    ...raw,
    is_tracked: raw.is_tracked === 1,
    tags: JSON.parse(raw.tags ?? "[]"),
    daily_goal_ms: raw.daily_goal_ms ?? null,
    // Never send raw file:// paths to the renderer — AppCard fetches icons
    // via getIconForApp which returns safe base64 data URLs.
    icon_cache_path: null,
    custom_image_path: null,
  };
}

function mapGroup(raw: {
  id: number;
  name: string;
  description: string;
  icon_cache_path: string | null;
  custom_image_path: string | null;
  tags: string;
  is_manual: number;
  created_at: number;
  daily_goal_ms: number | null;
  category: string | null;
}): AppGroup {
  return {
    ...raw,
    is_manual: raw.is_manual === 1,
    tags: JSON.parse(raw.tags ?? "[]"),
    daily_goal_ms: raw.daily_goal_ms ?? null,
    category: (raw.category as AppGroup["category"]) ?? null,
  };
}

export function registerIpcHandlers(): void {
  const db = getDb();

  // ── Apps ─────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.APPS_GET_ALL, (): AppRecord[] => {
    interface RawAppRow {
      id: number;
      exe_name: string;
      exe_path: string | null;
      display_name: string;
      group_id: number | null;
      is_tracked: number;
      icon_cache_path: string | null;
      custom_image_path: string | null;
      description: string;
      notes: string;
      tags: string;
      first_seen: number;
      last_seen: number;
      daily_goal_ms: number | null;
    }
    const rows = db.prepare<[], RawAppRow>("SELECT * FROM apps ORDER BY display_name COLLATE NOCASE").all();
    return rows.map(mapApp);
  });

  ipcMain.handle(
    CHANNELS.APPS_UPDATE,
    (_e, patch: Partial<AppRecord> & { id: number }): void => {
      const {
        id,
        display_name,
        description,
        notes,
        tags,
        group_id,
        daily_goal_ms,
      } = patch;
      const setClauses: string[] = [];
      const params: unknown[] = [];
      if (display_name !== undefined) {
        setClauses.push("display_name = ?");
        params.push(display_name);
      }
      if (description !== undefined) {
        setClauses.push("description = ?");
        params.push(description);
      }
      if (notes !== undefined) {
        setClauses.push("notes = ?");
        params.push(notes);
      }
      if (tags !== undefined) {
        setClauses.push("tags = ?");
        params.push(JSON.stringify(tags));
      }
      if (group_id !== undefined) {
        setClauses.push("group_id = ?");
        params.push(group_id);
      }
      if ("daily_goal_ms" in patch) {
        setClauses.push("daily_goal_ms = ?");
        params.push(daily_goal_ms ?? null);
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
    (_e, id: number, tracked: boolean): void => {
      db.prepare<[number, number]>(
        "UPDATE apps SET is_tracked = ? WHERE id = ?",
      ).run(tracked ? 1 : 0, id);
      // When an app is disabled, close any open running/active sessions
      // immediately so time stops accruing — don't wait for the next poll tick.
      if (!tracked) {
        const now = Date.now();
        console.log(`[IPC] APPS_SET_TRACKED: app id=${id} disabled — closing open sessions`);
        endRunningSession(id, now);
        endActiveSession(now);
      }
    },
  );

  ipcMain.handle(
    CHANNELS.APPS_SET_GROUP,
    (_e, id: number, groupId: number | null): void => {
      db.prepare<[number | null, number]>(
        "UPDATE apps SET group_id = ? WHERE id = ?",
      ).run(groupId, id);
    },
  );

  // ── Groups ────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.GROUPS_GET_ALL, (): AppGroup[] => {
    interface RawGroupRow {
      id: number;
      name: string;
      description: string;
      icon_cache_path: string | null;
      custom_image_path: string | null;
      tags: string;
      is_manual: number;
      created_at: number;
      daily_goal_ms: number | null;
      category: string | null;
    }
    const rows = db.prepare<[], RawGroupRow>("SELECT * FROM app_groups ORDER BY name COLLATE NOCASE").all();
    return rows.map(mapGroup);
  });

  ipcMain.handle(CHANNELS.GROUPS_CREATE, (_e, name: string): AppGroup => {
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
      description: "",
      icon_cache_path: null,
      custom_image_path: null,
      tags: [],
      is_manual: true,
      created_at: now,
      daily_goal_ms: null,
      category: null,
    };
  });

  ipcMain.handle(
    CHANNELS.GROUPS_UPDATE,
    (_e, patch: Partial<AppGroup> & { id: number }): void => {
      const { id, name, description, tags, daily_goal_ms, category } = patch;
      const setClauses: string[] = [];
      const params: unknown[] = [];
      if (name !== undefined) {
        setClauses.push("name = ?");
        params.push(name);
      }
      if (description !== undefined) {
        setClauses.push("description = ?");
        params.push(description);
      }
      if (tags !== undefined) {
        setClauses.push("tags = ?");
        params.push(JSON.stringify(tags));
      }
      if ("daily_goal_ms" in patch) {
        setClauses.push("daily_goal_ms = ?");
        params.push(daily_goal_ms ?? null);
      }
      if ("category" in patch) {
        setClauses.push("category = ?");
        params.push(category ?? null);
      }
      if (setClauses.length === 0) return;
      params.push(id);
      db.prepare(
        `UPDATE app_groups SET ${setClauses.join(", ")} WHERE id = ?`,
      ).run(...params);
    },
  );

  ipcMain.handle(CHANNELS.GROUPS_DELETE, (_e, id: number): void => {
    db.prepare<[number]>("DELETE FROM app_groups WHERE id = ?").run(id);
  });

  ipcMain.handle(CHANNELS.GROUPS_REANALYZE, async (): Promise<void> => {
    await reanalyzeGroups();
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
      const now = Date.now();

      // Query A: per-app aggregated totals via SQL — avoids loading all raw rows into JS
      // and eliminates the separate full apps-table fetch.
      const appSummaries = db
        .prepare<
          [number, number, number, number, number, number, number, number],
          {
            app_id: number;
            exe_name: string;
            display_name: string;
            group_id: number | null;
            active_ms: number;
            running_ms: number;
          }
        >(
          `SELECT a.id AS app_id, a.exe_name, a.display_name, a.group_id,
                  SUM(CASE WHEN s.session_type = 'active'
                       THEN MAX(0, MIN(COALESCE(s.ended_at, ?), ?) - MAX(s.started_at, ?))
                       ELSE 0 END) AS active_ms,
                  SUM(CASE WHEN s.session_type = 'running'
                       THEN MAX(0, MIN(COALESCE(s.ended_at, ?), ?) - MAX(s.started_at, ?))
                       ELSE 0 END) AS running_ms
           FROM sessions s
           JOIN apps a ON a.id = s.app_id
           WHERE s.started_at < ?
             AND (s.ended_at IS NULL OR s.ended_at > ?)
           GROUP BY s.app_id
           ORDER BY active_ms DESC`,
        )
        .all(now, to, from, now, to, from, to, from);

      // Query B: chart points bucketed in SQL — no JS date-formatting loop
      const dateFmt = groupBy === "hour"
        ? "%Y-%m-%d %H:00"
        : "%Y-%m-%d";
      const chartPoints = db
        .prepare<
          [string, number, number, number, number, number, number, number, number, number],
          { date: string; active_ms: number; running_ms: number }
        >(
          `SELECT strftime(?, MAX(s.started_at, ?) / 1000, 'unixepoch', 'localtime') AS date,
                  SUM(CASE WHEN s.session_type = 'active'
                       THEN MAX(0, MIN(COALESCE(s.ended_at, ?), ?) - MAX(s.started_at, ?))
                       ELSE 0 END) AS active_ms,
                  SUM(CASE WHEN s.session_type = 'running'
                       THEN MAX(0, MIN(COALESCE(s.ended_at, ?), ?) - MAX(s.started_at, ?))
                       ELSE 0 END) AS running_ms
           FROM sessions s
           WHERE s.started_at < ?
             AND (s.ended_at IS NULL OR s.ended_at > ?)
           GROUP BY date
           ORDER BY date`,
        )
        .all(dateFmt, from, now, to, from, now, to, from, to, from);

      const totalActive = appSummaries.reduce((acc, a) => acc + a.active_ms, 0);
      const totalRunning = appSummaries.reduce((acc, a) => acc + a.running_ms, 0);

      return {
        from,
        to,
        total_active_ms: totalActive,
        total_running_ms: totalRunning,
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
      const now = Date.now();
      const sessions = isGroup
        ? db
            .prepare<
              [number, number, number, number, number, number],
              {
                app_id: number;
                session_type: string;
                started_at: number;
                ended_at: number;
              }
            >(
              `SELECT s.app_id, s.session_type,
                      MAX(s.started_at, ?) AS started_at,
                      MIN(COALESCE(s.ended_at, ?), ?) AS ended_at
               FROM sessions s
               WHERE s.app_id IN (SELECT id FROM apps WHERE group_id = ?)
                 AND s.started_at < ?
                 AND (s.ended_at IS NULL OR s.ended_at > ?)`,
            )
            .all(from, now, to, id, to, from)
        : db
            .prepare<
              [number, number, number, number, number, number],
              {
                app_id: number;
                session_type: string;
                started_at: number;
                ended_at: number;
              }
            >(
              `SELECT app_id, session_type,
                      MAX(started_at, ?) AS started_at,
                      MIN(COALESCE(ended_at, ?), ?) AS ended_at
               FROM sessions
               WHERE app_id = ?
                 AND started_at < ?
                 AND (ended_at IS NULL OR ended_at > ?)`,
            )
            .all(from, now, to, id, to, from);

      let active_ms = 0;
      let running_ms = 0;
      for (const s of sessions) {
        const dur = s.ended_at - s.started_at;
        if (s.session_type === "active") active_ms += dur;
        else running_ms += dur;
      }

      const fmt = (ts: number): string => {
        const d = new Date(ts);
        if (groupBy === "hour") {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:00`;
        }
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };

      const chartMap = new Map<string, ChartDataPoint>();
      for (const s of sessions) {
        const key = fmt(s.started_at);
        if (!chartMap.has(key))
          chartMap.set(key, { date: key, active_ms: 0, running_ms: 0 });
        const pt = chartMap.get(key)!;
        const dur = s.ended_at - s.started_at;
        if (s.session_type === "active") pt.active_ms += dur;
        else pt.running_ms += dur;
      }

      let member_summaries: SessionSummary[] = [];
      if (isGroup) {
        const members = db
          .prepare<
            [number],
            { id: number; exe_name: string; display_name: string }
          >("SELECT id, exe_name, display_name FROM apps WHERE group_id = ?")
          .all(id);
        const memberMap = new Map<number, SessionSummary>();
        for (const m of members) {
          memberMap.set(m.id, {
            app_id: m.id,
            exe_name: m.exe_name,
            display_name: m.display_name,
            group_id: id,
            active_ms: 0,
            running_ms: 0,
          });
        }
        for (const s of sessions) {
          const entry = memberMap.get(s.app_id);
          if (!entry) continue;
          const dur = s.ended_at - s.started_at;
          if (s.session_type === "active") entry.active_ms += dur;
          else entry.running_ms += dur;
        }
        member_summaries = Array.from(memberMap.values()).sort(
          (a, b) => b.active_ms - a.active_ms,
        );
      }

      return {
        active_ms,
        running_ms,
        chart_points: Array.from(chartMap.values()).sort((a, b) =>
          a.date.localeCompare(b.date),
        ),
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
      console.log(`[IPC] getDailyTotals from=${new Date(from).toISOString()} to=${new Date(to).toISOString()}`);
      const now = Date.now();
      const rows = db
        .prepare<[number, number, number, number], { date: string; active_ms: number }>(
          `SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch', 'localtime') AS date,
                  SUM(MIN(COALESCE(ended_at, ?), ?) - started_at) AS active_ms
           FROM sessions
           WHERE session_type = 'active'
             AND started_at >= ?
             AND started_at < ?
           GROUP BY date
           ORDER BY date`,
        )
        .all(now, to, from, to);
      console.log(`[IPC] getDailyTotals -> ${rows.length} day(s) returned`);
      return rows;
    },
  );

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_BUCKET_APPS,
    (_e, from: number, to: number): BucketApp[] => {
      console.log(`[IPC] getBucketApps from=${new Date(from).toISOString()} to=${new Date(to).toISOString()}`);
      const now = Date.now();
      const rows = db
        .prepare<
          [number, number, number, number],
          { app_id: number; display_name: string; active_ms: number }
        >(
          `SELECT s.app_id,
                  a.display_name,
                  SUM(MIN(COALESCE(s.ended_at, ?), ?) - s.started_at) AS active_ms
           FROM sessions s
           JOIN apps a ON a.id = s.app_id
           WHERE s.session_type = 'active'
             AND s.started_at >= ?
             AND s.started_at < ?
           GROUP BY s.app_id
           ORDER BY active_ms DESC
           LIMIT 5`,
        )
        .all(now, to, from, to);
      console.log(`[IPC] getBucketApps -> ${rows.length} app(s):`, rows.map(r => `${r.display_name}=${Math.round(r.active_ms/60000)}m`).join(', '));
      return rows;
    },
  );

  ipcMain.handle(CHANNELS.SESSIONS_CLEAR_ALL, (): void => {
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
        app.setLoginItemSettings({
          openAtLogin: value === true || value === "true",
        });
      }
    },
  );

  // ── Icons ─────────────────────────────────────────────────────────────────

  // ── Shared icon resolution helpers ───────────────────────────────────────

  async function resolveAppIcon(appId: number): Promise<string | null> {
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
      const result: Record<string, string | null> = {};
      for (const req of requests) {
        const key = `${req.isGroup ? "g" : "a"}:${req.id}`;
        try {
          result[key] = req.isGroup
            ? await resolveGroupIcon(req.id)
            : await resolveAppIcon(req.id);
        } catch {
          result[key] = null;
        }
      }
      return result;
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
      try {
        const res = await net.fetch(imgUrl);
        if (!res.ok) return null;

        const contentType = res.headers.get("content-type") ?? "image/png";
        const mime = contentType.split(";")[0].trim();
        const extMap: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/gif": "gif",
          "image/webp": "webp",
          "image/svg+xml": "svg",
        };
        const ext = extMap[mime] ?? "png";

        const buf = Buffer.from(await res.arrayBuffer());
        const base64 = `data:${mime};base64,${buf.toString("base64")}`;

        const fsPath = saveCustomImage(id, base64, ext);
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
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    CHANNELS.ICONS_CLEAR_CUSTOM,
    (_e, id: number, isGroup = false): void => {
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
