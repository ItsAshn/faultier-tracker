import { net } from 'electron'
import { getDb, getSetting } from '../db/client'
import type { SteamImportResult } from '@shared/types'

interface SteamGame {
  appid: number
  name: string
  playtime_forever: number   // total playtime in minutes
  rtime_last_played: number  // Unix timestamp (seconds) of last play session
}

interface SteamApiResponse {
  response?: {
    game_count?: number
    games?: SteamGame[]
  }
}

/**
 * Refresh Steam playtimes and create delta sessions.
 * Only creates sessions for NEW playtime since last refresh.
 * This makes Steam games appear in charts alongside tracked games.
 */
export async function refreshSteamPlaytimes(
  apiKey: string,
  steamId: string
): Promise<{ updated: number; totalDeltaMs: number }> {
  const result = { updated: 0, totalDeltaMs: 0 }

  console.log(`[SteamRefresh] starting refresh for steamId=${steamId}`)

  // Fetch current data from Steam API
  let games: SteamGame[]
  try {
    const url =
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/` +
      `?key=${encodeURIComponent(apiKey)}` +
      `&steamid=${encodeURIComponent(steamId)}` +
      `&include_appinfo=1&include_played_free_games=1&format=json`

    const res = await net.fetch(url)

    if (!res.ok) {
      console.error(`[SteamRefresh] API error: HTTP ${res.status}`)
      return result
    }

    const data = await res.json() as SteamApiResponse
    games = data.response?.games?.filter((g) => g.playtime_forever > 0) ?? []
    console.log(`[SteamRefresh] fetched ${games.length} games with playtime`)
  } catch (err) {
    console.error('[SteamRefresh] fetch failed:', err)
    return result
  }

  const db = getDb()
  const now = Date.now()

  db.transaction(() => {
    for (const game of games) {
      const exeName = `steam:${game.appid}`
      const currentPlaytimeMs = game.playtime_forever * 60 * 1000

      // Get or create the Steam app
      let appRow = db
        .prepare<[string], { id: number; last_steam_playtime_ms: number | null } | undefined>(
          'SELECT id, last_steam_playtime_ms FROM apps WHERE exe_name = ?'
        )
        .get(exeName)

      let appId: number
      let lastPlaytimeMs = 0

      if (appRow) {
        appId = appRow.id
        lastPlaytimeMs = appRow.last_steam_playtime_ms ?? 0
        // Update last_seen and ensure is_steam_import flag is set
        db.prepare(
          'UPDATE apps SET last_seen = ?, is_steam_import = 1 WHERE id = ?'
        ).run(now, appId)
      } else {
        // Create new Steam app
        const insertResult = db
          .prepare<[string, string, number, number], { lastInsertRowid: number | bigint }>(
            `INSERT INTO apps (exe_name, exe_path, display_name, group_id, first_seen, last_seen, is_tracked, is_steam_import)
             VALUES (?, NULL, ?, NULL, ?, ?, 1, 1)`
          )
          .run(exeName, game.name, now, now)
        appId = insertResult.lastInsertRowid as number
        console.log(`[SteamRefresh] created new Steam app: ${game.name} (${exeName})`)
      }

      // Calculate delta (new playtime since last refresh)
      const deltaMs = currentPlaytimeMs - lastPlaytimeMs

      if (deltaMs > 0) {
        // Create a session for just the new playtime
        // Use endedAt = now, startedAt = now - deltaMs
        const endedAt = now
        const startedAt = now - deltaMs

        db.prepare(
          `INSERT INTO sessions (app_id, session_type, started_at, ended_at, machine_id)
           VALUES (?, 'active', ?, ?, 'steam-import')`
        ).run(appId, startedAt, endedAt)

        // Update cached playtime
        db.prepare(
          'UPDATE apps SET last_steam_playtime_ms = ? WHERE id = ?'
        ).run(currentPlaytimeMs, appId)

        result.updated++
        result.totalDeltaMs += deltaMs
        console.log(
          `[SteamRefresh] ${game.name}: +${Math.round(deltaMs / 60000)}m (total: ${Math.round(currentPlaytimeMs / 60000)}m)`
        )
      }
    }
  })()

  console.log(
    `[SteamRefresh] complete — updated ${result.updated} games, total delta: ${Math.round(result.totalDeltaMs / 60000)}m`
  )
  return result
}

export async function importFromSteam(apiKey: string, steamId: string): Promise<SteamImportResult> {
  const result: SteamImportResult = { gamesImported: 0, sessionsAdded: 0, duplicates: 0, errors: [] }

  console.log(`[SteamImport] starting import for steamId=${steamId}`)

  // ── Fetch games from Steam API ─────────────────────────────────────────────
  let games: SteamGame[]
  try {
    const url =
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/` +
      `?key=${encodeURIComponent(apiKey)}` +
      `&steamid=${encodeURIComponent(steamId)}` +
      `&include_appinfo=1&include_played_free_games=1&format=json`

    console.log(`[SteamImport] fetching from Steam API...`)
    const res = await net.fetch(url)
    console.log(`[SteamImport] Steam API response status: ${res.status}`)

    if (res.status === 401 || res.status === 403) {
      result.errors.push('Invalid API key. Visit steamcommunity.com/dev/apikey to get one.')
      return result
    }
    if (!res.ok) {
      result.errors.push(`Steam API error: HTTP ${res.status}`)
      return result
    }

    const data = await res.json() as SteamApiResponse
    console.log(`[SteamImport] total games in response: ${data.response?.game_count ?? 0}`)

    if (!data.response?.games?.length) {
      result.errors.push(
        'No games found. Your Steam profile may be set to private, or you have no games with recorded playtime.'
      )
      return result
    }

    games = data.response.games.filter((g) => g.playtime_forever > 0)
    console.log(`[SteamImport] games with playtime > 0: ${games.length}`)

    if (games.length === 0) {
      result.errors.push('No games with recorded playtime found.')
      return result
    }
  } catch (err) {
    result.errors.push(`Could not reach Steam API: ${err instanceof Error ? err.message : String(err)}`)
    console.error(`[SteamImport] network error:`, err)
    return result
  }

  // ── Write to DB ────────────────────────────────────────────────────────────
  const db = getDb()
  const now = Date.now()

  const getApp = db.prepare<[string], { id: number } | undefined>(
    'SELECT id FROM apps WHERE exe_name = ?'
  )
  const insertApp = db.prepare<[string, string, number, number], { lastInsertRowid: number | bigint }>(
    `INSERT INTO apps (exe_name, exe_path, display_name, group_id, first_seen, last_seen, is_tracked, is_steam_import)
     VALUES (?, NULL, ?, NULL, ?, ?, 1, 1)`
  )
  const updateApp = db.prepare<[string, number, number], void>(
    'UPDATE apps SET display_name = ?, last_seen = ?, is_steam_import = 1 WHERE id = ?'
  )
  const hasSteamSession = db.prepare<[number], { count: number }>(
    "SELECT COUNT(*) as count FROM sessions WHERE app_id = ? AND machine_id = 'steam-import'"
  )
  const insertSession = db.prepare<[number, string, number, number, string], void>(
    'INSERT INTO sessions (app_id, session_type, started_at, ended_at, machine_id) VALUES (?, ?, ?, ?, ?)'
  )

  db.transaction(() => {
    for (const game of games) {
      const exeName = `steam:${game.appid}`
      const playtimeMs = game.playtime_forever * 60 * 1000
      const endedAt = game.rtime_last_played > 0 ? game.rtime_last_played * 1000 : now
      const startedAt = endedAt - playtimeMs

      // Upsert app
      let appId: number
      const existing = getApp.get(exeName)
      if (existing) {
        appId = existing.id
        updateApp.run(game.name, now, appId)
        console.log(`[SteamImport] updated existing app id=${appId} exeName=${exeName} name="${game.name}"`)
      } else {
        const r = insertApp.run(exeName, game.name, now, now)
        appId = r.lastInsertRowid as number
        result.gamesImported++
        console.log(`[SteamImport] inserted new app id=${appId} exeName=${exeName} name="${game.name}"`)
      }

      // For initial import, create one big session for total playtime
      // and set last_steam_playtime_ms to current value
      const dup = hasSteamSession.get(appId)
      if ((dup?.count ?? 0) > 0) {
        result.duplicates++
        console.log(`[SteamImport] skipping duplicate session for app id=${appId} name="${game.name}"`)
      } else {
        insertSession.run(appId, 'active', startedAt, endedAt, 'steam-import')
        result.sessionsAdded++
        console.log(`[SteamImport] inserted session for app id=${appId} name="${game.name}" playtime=${Math.round(playtimeMs/60000)}m`)
      }

      // Always update last_steam_playtime_ms to current value
      db.prepare(
        'UPDATE apps SET last_steam_playtime_ms = ? WHERE id = ?'
      ).run(playtimeMs, appId)
    }
  })()

  console.log(`[SteamImport] done — gamesImported=${result.gamesImported} sessionsAdded=${result.sessionsAdded} duplicates=${result.duplicates} errors=${result.errors.length}`)
  return result
}
