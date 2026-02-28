import { net } from 'electron'
import { getDb } from '../db/client'
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

export async function importFromSteam(apiKey: string, steamId: string): Promise<SteamImportResult> {
  const result: SteamImportResult = { gamesImported: 0, sessionsAdded: 0, duplicates: 0, errors: [] }

  // ── Fetch games from Steam API ─────────────────────────────────────────────
  let games: SteamGame[]
  try {
    const url =
      `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/` +
      `?key=${encodeURIComponent(apiKey)}` +
      `&steamid=${encodeURIComponent(steamId)}` +
      `&include_appinfo=1&include_played_free_games=1&format=json`

    const res = await net.fetch(url)

    if (res.status === 401 || res.status === 403) {
      result.errors.push('Invalid API key. Visit steamcommunity.com/dev/apikey to get one.')
      return result
    }
    if (!res.ok) {
      result.errors.push(`Steam API error: HTTP ${res.status}`)
      return result
    }

    const data = await res.json() as SteamApiResponse

    if (!data.response?.games?.length) {
      result.errors.push(
        'No games found. Your Steam profile may be set to private, or you have no games with recorded playtime.'
      )
      return result
    }

    games = data.response.games.filter((g) => g.playtime_forever > 0)

    if (games.length === 0) {
      result.errors.push('No games with recorded playtime found.')
      return result
    }
  } catch (err) {
    result.errors.push(`Could not reach Steam API: ${err instanceof Error ? err.message : String(err)}`)
    return result
  }

  // ── Write to DB ────────────────────────────────────────────────────────────
  const db = getDb()
  const now = Date.now()

  const getApp = db.prepare<[string], { id: number } | undefined>(
    'SELECT id FROM apps WHERE exe_name = ?'
  )
  const insertApp = db.prepare<[string, string, number, number], { lastInsertRowid: number | bigint }>(
    `INSERT INTO apps (exe_name, exe_path, display_name, group_id, description, notes, tags, first_seen, last_seen, is_tracked)
     VALUES (?, NULL, ?, NULL, '', '', '[]', ?, ?, 1)`
  )
  const updateApp = db.prepare<[string, number, number], void>(
    'UPDATE apps SET display_name = ?, last_seen = ? WHERE id = ?'
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
      } else {
        const r = insertApp.run(exeName, game.name, now, now)
        appId = r.lastInsertRowid as number
        result.gamesImported++
      }

      // One synthetic session per game — skip if already imported
      const dup = hasSteamSession.get(appId)
      if ((dup?.count ?? 0) > 0) {
        result.duplicates++
        continue
      }

      insertSession.run(appId, 'running', startedAt, endedAt, 'steam-import')
      result.sessionsAdded++
    }
  })()

  return result
}
