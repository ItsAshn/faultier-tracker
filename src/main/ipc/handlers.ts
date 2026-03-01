import { ipcMain, dialog, BrowserWindow, net } from 'electron'
import { getDb, getSetting, setSetting, getAllSettings } from '../db/client'
import { extractAndCacheIcon, saveCustomImage, clearCustomImage, readFileAsDataUrl } from '../icons/iconExtractor'
import { reanalyzeGroups, invalidateGroupCache } from '../grouping/groupEngine'
import { exportData, importData } from '../importExport/dataTransfer'
import { importFromSteam } from '../importExport/steamImport'
import { autoFetchSteamArtwork } from '../artwork/autoFetch'
import { searchSteamGridDB } from '../artwork/artworkProvider'
import { CHANNELS } from '@shared/channels'
import type {
  AppRecord, AppGroup, SessionSummary, RangeSummary, ChartDataPoint, WindowControlAction,
  ArtworkSearchResponse, AppRangeSummary
} from '@shared/types'
import { getMainWindow } from '../window'
import { startTracker, stopTracker } from '../tracking/tracker'

function mapApp(raw: {
  id: number; exe_name: string; exe_path: string | null; display_name: string;
  group_id: number | null; is_tracked: number; icon_cache_path: string | null;
  custom_image_path: string | null; description: string; notes: string; tags: string;
  first_seen: number; last_seen: number
}): AppRecord {
  return {
    ...raw,
    is_tracked: raw.is_tracked === 1,
    tags: JSON.parse(raw.tags ?? '[]'),
    // Never send raw file:// paths to the renderer — AppCard fetches icons
    // via getIconForApp which returns safe base64 data URLs.
    icon_cache_path: null,
    custom_image_path: null,
  }
}

function mapGroup(raw: {
  id: number; name: string; description: string; icon_cache_path: string | null;
  custom_image_path: string | null; tags: string; is_manual: number; created_at: number
}): AppGroup {
  return {
    ...raw,
    is_manual: raw.is_manual === 1,
    tags: JSON.parse(raw.tags ?? '[]')
  }
}

export function registerIpcHandlers(): void {
  const db = getDb()

  // ── Apps ─────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.APPS_GET_ALL, (): AppRecord[] => {
    return db
      .prepare<[], ReturnType<typeof mapApp>>(
        'SELECT * FROM apps ORDER BY display_name COLLATE NOCASE'
      )
      .all()
      .map(mapApp)
  })

  ipcMain.handle(CHANNELS.APPS_UPDATE, (_e, patch: Partial<AppRecord> & { id: number }): void => {
    const { id, display_name, description, notes, tags, group_id } = patch
    if (display_name !== undefined)
      db.prepare<[string, number]>('UPDATE apps SET display_name = ? WHERE id = ?').run(display_name, id)
    if (description !== undefined)
      db.prepare<[string, number]>('UPDATE apps SET description = ? WHERE id = ?').run(description, id)
    if (notes !== undefined)
      db.prepare<[string, number]>('UPDATE apps SET notes = ? WHERE id = ?').run(notes, id)
    if (tags !== undefined)
      db.prepare<[string, number]>('UPDATE apps SET tags = ? WHERE id = ?').run(JSON.stringify(tags), id)
    if (group_id !== undefined)
      db.prepare<[number | null, number]>('UPDATE apps SET group_id = ? WHERE id = ?').run(group_id, id)
  })

  ipcMain.handle(CHANNELS.APPS_SET_TRACKED, (_e, id: number, tracked: boolean): void => {
    db.prepare<[number, number]>('UPDATE apps SET is_tracked = ? WHERE id = ?').run(tracked ? 1 : 0, id)
  })

  ipcMain.handle(CHANNELS.APPS_SET_GROUP, (_e, id: number, groupId: number | null): void => {
    db.prepare<[number | null, number]>('UPDATE apps SET group_id = ? WHERE id = ?').run(groupId, id)
  })

  // ── Groups ────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.GROUPS_GET_ALL, (): AppGroup[] => {
    return db
      .prepare<[], ReturnType<typeof mapGroup>>('SELECT * FROM app_groups ORDER BY name COLLATE NOCASE')
      .all()
      .map(mapGroup)
  })

  ipcMain.handle(CHANNELS.GROUPS_CREATE, (_e, name: string): AppGroup => {
    const now = Date.now()
    const result = db
      .prepare<[string, number]>(
        'INSERT INTO app_groups (name, is_manual, created_at) VALUES (?, 1, ?)'
      )
      .run(name, now)
    const id = result.lastInsertRowid as number
    return {
      id, name, description: '', icon_cache_path: null, custom_image_path: null,
      tags: [], is_manual: true, created_at: now
    }
  })

  ipcMain.handle(CHANNELS.GROUPS_UPDATE, (_e, patch: Partial<AppGroup> & { id: number }): void => {
    const { id, name, description, tags } = patch
    if (name !== undefined)
      db.prepare<[string, number]>('UPDATE app_groups SET name = ? WHERE id = ?').run(name, id)
    if (description !== undefined)
      db.prepare<[string, number]>('UPDATE app_groups SET description = ? WHERE id = ?').run(description, id)
    if (tags !== undefined)
      db.prepare<[string, number]>('UPDATE app_groups SET tags = ? WHERE id = ?').run(JSON.stringify(tags), id)
  })

  ipcMain.handle(CHANNELS.GROUPS_DELETE, (_e, id: number): void => {
    db.prepare<[number]>('DELETE FROM app_groups WHERE id = ?').run(id)
  })

  ipcMain.handle(CHANNELS.GROUPS_REANALYZE, async (): Promise<void> => {
    await reanalyzeGroups()
  })

  // ── Sessions ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_RANGE,
    (_e, from: number, to: number, groupBy: 'hour' | 'day' = 'day'): RangeSummary => {
      const now = Date.now()
      const sessions = db
        .prepare<
          [number, number, number, number],
          { app_id: number; session_type: string; started_at: number; ended_at: number }
        >(
          `SELECT app_id, session_type, started_at,
                  MIN(COALESCE(ended_at, ?), ?) AS ended_at
           FROM sessions
           WHERE started_at >= ?
             AND (ended_at IS NULL OR ended_at <= ?)`
        )
        .all(now, to, from, to)

      const apps = db
        .prepare<[], { id: number; exe_name: string; display_name: string; group_id: number | null }>(
          'SELECT id, exe_name, display_name, group_id FROM apps'
        )
        .all()

      const appMap = new Map(apps.map((a) => [a.id, a]))
      const summaryMap = new Map<number, SessionSummary>()

      for (const s of sessions) {
        const app = appMap.get(s.app_id)
        if (!app) continue
        const dur = s.ended_at - s.started_at
        if (!summaryMap.has(s.app_id)) {
          summaryMap.set(s.app_id, {
            app_id: s.app_id,
            exe_name: app.exe_name,
            display_name: app.display_name,
            group_id: app.group_id,
            active_ms: 0,
            running_ms: 0
          })
        }
        const entry = summaryMap.get(s.app_id)!
        if (s.session_type === 'active') entry.active_ms += dur
        else entry.running_ms += dur
      }

      const appSummaries = Array.from(summaryMap.values()).sort(
        (a, b) => b.active_ms - a.active_ms
      )

      // Chart points
      const chartMap = new Map<string, ChartDataPoint>()
      const fmt = (ts: number): string => {
        const d = new Date(ts)
        if (groupBy === 'hour') {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
        }
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }

      for (const s of sessions) {
        const key = fmt(s.started_at)
        if (!chartMap.has(key)) chartMap.set(key, { date: key, active_ms: 0, running_ms: 0 })
        const pt = chartMap.get(key)!
        const dur = s.ended_at - s.started_at
        if (s.session_type === 'active') pt.active_ms += dur
        else pt.running_ms += dur
      }

      const totalActive = appSummaries.reduce((acc, a) => acc + a.active_ms, 0)
      const totalRunning = appSummaries.reduce((acc, a) => acc + a.running_ms, 0)

      return {
        from, to,
        total_active_ms: totalActive,
        total_running_ms: totalRunning,
        top_app: appSummaries[0] ?? null,
        apps: appSummaries,
        chart_points: Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))
      }
    }
  )

  ipcMain.handle(
    CHANNELS.SESSIONS_GET_APP_RANGE,
    (_e, id: number, from: number, to: number, groupBy: 'hour' | 'day', isGroup: boolean): AppRangeSummary => {
      const now = Date.now()
      const sessions = isGroup
        ? db
            .prepare<
              [number, number, number, number, number],
              { app_id: number; session_type: string; started_at: number; ended_at: number }
            >(
              `SELECT s.app_id, s.session_type, s.started_at,
                      MIN(COALESCE(s.ended_at, ?), ?) AS ended_at
               FROM sessions s
               WHERE s.app_id IN (SELECT id FROM apps WHERE group_id = ?)
                 AND s.started_at >= ?
                 AND (s.ended_at IS NULL OR s.ended_at <= ?)`
            )
            .all(now, to, id, from, to)
        : db
            .prepare<
              [number, number, number, number, number],
              { app_id: number; session_type: string; started_at: number; ended_at: number }
            >(
              `SELECT app_id, session_type, started_at,
                      MIN(COALESCE(ended_at, ?), ?) AS ended_at
               FROM sessions
               WHERE app_id = ?
                 AND started_at >= ?
                 AND (ended_at IS NULL OR ended_at <= ?)`
            )
            .all(now, to, id, from, to)

      let active_ms = 0
      let running_ms = 0
      for (const s of sessions) {
        const dur = s.ended_at - s.started_at
        if (s.session_type === 'active') active_ms += dur
        else running_ms += dur
      }

      const fmt = (ts: number): string => {
        const d = new Date(ts)
        if (groupBy === 'hour') {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
        }
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      }

      const chartMap = new Map<string, ChartDataPoint>()
      for (const s of sessions) {
        const key = fmt(s.started_at)
        if (!chartMap.has(key)) chartMap.set(key, { date: key, active_ms: 0, running_ms: 0 })
        const pt = chartMap.get(key)!
        const dur = s.ended_at - s.started_at
        if (s.session_type === 'active') pt.active_ms += dur
        else pt.running_ms += dur
      }

      let member_summaries: SessionSummary[] = []
      if (isGroup) {
        const members = db
          .prepare<[number], { id: number; exe_name: string; display_name: string }>(
            'SELECT id, exe_name, display_name FROM apps WHERE group_id = ?'
          )
          .all(id)
        const memberMap = new Map<number, SessionSummary>()
        for (const m of members) {
          memberMap.set(m.id, {
            app_id: m.id,
            exe_name: m.exe_name,
            display_name: m.display_name,
            group_id: id,
            active_ms: 0,
            running_ms: 0
          })
        }
        for (const s of sessions) {
          const entry = memberMap.get(s.app_id)
          if (!entry) continue
          const dur = s.ended_at - s.started_at
          if (s.session_type === 'active') entry.active_ms += dur
          else entry.running_ms += dur
        }
        member_summaries = Array.from(memberMap.values()).sort((a, b) => b.active_ms - a.active_ms)
      }

      return {
        active_ms,
        running_ms,
        chart_points: Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
        member_summaries
      }
    }
  )

  ipcMain.handle(CHANNELS.SESSIONS_CLEAR_ALL, (): void => {
    db.prepare('DELETE FROM sessions').run()
  })

  // ── Settings ──────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.SETTINGS_GET_ALL, () => getAllSettings())

  ipcMain.handle(CHANNELS.SETTINGS_SET, (_e, key: string, value: unknown): void => {
    setSetting(key, value)
    // Restart tracker if poll interval changed
    if (key === 'poll_interval_ms') {
      stopTracker()
      startTracker()
    }
  })

  // ── Icons ─────────────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.ICONS_GET_FOR_APP, async (_e, appId: number): Promise<string | null> => {
    const row = db
      .prepare<[number], { exe_path: string | null; icon_cache_path: string | null; custom_image_path: string | null }>(
        'SELECT exe_path, icon_cache_path, custom_image_path FROM apps WHERE id = ?'
      )
      .get(appId)
    if (!row) return null

    // custom image takes priority
    const customDataUrl = readFileAsDataUrl(row.custom_image_path)
    if (customDataUrl) return customDataUrl

    // cached exe icon
    const cachedDataUrl = readFileAsDataUrl(row.icon_cache_path)
    if (cachedDataUrl) return cachedDataUrl

    // extract fresh from exe
    if (row.exe_path) {
      const fsPath = await extractAndCacheIcon(appId, row.exe_path)
      if (fsPath) {
        db.prepare<[string, number]>('UPDATE apps SET icon_cache_path = ? WHERE id = ?').run(fsPath, appId)
        return readFileAsDataUrl(fsPath)
      }
    }

    return null
  })

  ipcMain.handle(CHANNELS.ICONS_GET_FOR_GROUP, async (_e, groupId: number): Promise<string | null> => {
    const group = db
      .prepare<[number], { icon_cache_path: string | null; custom_image_path: string | null }>(
        'SELECT icon_cache_path, custom_image_path FROM app_groups WHERE id = ?'
      )
      .get(groupId)
    if (!group) return null

    const customDataUrl = readFileAsDataUrl(group.custom_image_path)
    if (customDataUrl) return customDataUrl

    const cachedDataUrl = readFileAsDataUrl(group.icon_cache_path)
    if (cachedDataUrl) return cachedDataUrl

    // Fall back to a member app's icon
    const member = db
      .prepare<[number], { id: number; exe_path: string | null; icon_cache_path: string | null }>(
        'SELECT id, exe_path, icon_cache_path FROM apps WHERE group_id = ? AND exe_path IS NOT NULL LIMIT 1'
      )
      .get(groupId)

    if (member) {
      const memberDataUrl = readFileAsDataUrl(member.icon_cache_path)
      if (memberDataUrl) return memberDataUrl

      if (member.exe_path) {
        const fsPath = await extractAndCacheIcon(member.id, member.exe_path)
        if (fsPath) {
          db.prepare<[string, number]>('UPDATE apps SET icon_cache_path = ? WHERE id = ?').run(fsPath, member.id)
          db.prepare<[string, number]>('UPDATE app_groups SET icon_cache_path = ? WHERE id = ?').run(fsPath, groupId)
          return readFileAsDataUrl(fsPath)
        }
      }
    }
    return null
  })

  ipcMain.handle(
    CHANNELS.ICONS_SET_CUSTOM,
    async (_e, id: number, base64: string, isGroup = false): Promise<string> => {
      const fsPath = saveCustomImage(id, base64)
      if (isGroup) {
        db.prepare<[string, number]>('UPDATE app_groups SET custom_image_path = ? WHERE id = ?').run(fsPath, id)
      } else {
        db.prepare<[string, number]>('UPDATE apps SET custom_image_path = ? WHERE id = ?').run(fsPath, id)
      }
      // Return the original base64 — no need to re-read the file we just wrote
      return base64
    }
  )

  ipcMain.handle(
    CHANNELS.ICONS_FETCH_URL,
    async (_e, id: number, imgUrl: string, isGroup = false): Promise<string | null> => {
      try {
        const res = await net.fetch(imgUrl)
        if (!res.ok) return null

        const contentType = res.headers.get('content-type') ?? 'image/png'
        const mime = contentType.split(';')[0].trim()
        const extMap: Record<string, string> = {
          'image/jpeg': 'jpg', 'image/gif': 'gif',
          'image/webp': 'webp', 'image/svg+xml': 'svg'
        }
        const ext = extMap[mime] ?? 'png'

        const buf = Buffer.from(await res.arrayBuffer())
        const base64 = `data:${mime};base64,${buf.toString('base64')}`

        const fsPath = saveCustomImage(id, base64, ext)
        if (isGroup) {
          db.prepare<[string, number]>('UPDATE app_groups SET custom_image_path = ? WHERE id = ?').run(fsPath, id)
        } else {
          db.prepare<[string, number]>('UPDATE apps SET custom_image_path = ? WHERE id = ?').run(fsPath, id)
        }
        return base64
      } catch {
        return null
      }
    }
  )

  ipcMain.handle(CHANNELS.ICONS_CLEAR_CUSTOM, (_e, id: number, isGroup = false): void => {
    clearCustomImage(id)
    if (isGroup) {
      db.prepare<[number]>('UPDATE app_groups SET custom_image_path = NULL WHERE id = ?').run(id)
    } else {
      db.prepare<[number]>('UPDATE apps SET custom_image_path = NULL WHERE id = ?').run(id)
    }
  })

  // ── Artwork search ────────────────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.ARTWORK_SEARCH,
    async (_e, query: string, type?: string): Promise<ArtworkSearchResponse> => {
      const apiKey = getSetting('steamgriddb_api_key') as string | null
      if (!apiKey) return { results: [], error: 'no_key' }
      try {
        const results = await searchSteamGridDB(
          query,
          apiKey,
          (type as 'grids' | 'heroes' | 'logos' | 'icons') ?? 'grids'
        )
        return { results }
      } catch (err) {
        return { results: [], error: (err as Error).message }
      }
    }
  )

  // ── Data transfer ─────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.DATA_EXPORT, () => exportData())
  ipcMain.handle(CHANNELS.DATA_IMPORT, () => importData())
  ipcMain.handle(CHANNELS.DATA_STEAM_IMPORT, async (_e, apiKey: string, steamId: string) => {
    const result = await importFromSteam(apiKey, steamId)
    if (result.gamesImported > 0) {
      // Fire-and-forget background artwork fetch for newly imported games
      autoFetchSteamArtwork().catch(console.error)
    }
    return result
  })

  // ── Window control ────────────────────────────────────────────────────────

  ipcMain.on(CHANNELS.WINDOW_CONTROL, (_e, action: WindowControlAction) => {
    const win = getMainWindow()
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
    else if (action === 'close') win.hide()
  })
}
