import { getDb, getSetting } from '../db/client'

interface OpenSession {
  dbId: number
  startedAt: number
  lastTick: number
}

// In-memory map for the currently open active session
const activeSessions = new Map<number, OpenSession>()   // app_id → session

let machineId = ''
let _lastTickTime = 0

export function initSessionManager(mid: string): void {
  machineId = mid
}

function getPollInterval(): number {
  const raw = getSetting('poll_interval_ms')
  return typeof raw === 'number' ? raw : 5000
}

function openSession(
  appId: number,
  now: number
): number {
  const db = getDb()
  const result = db
    .prepare<[number, number, string], { lastInsertRowid: number | bigint }>(
      `INSERT INTO sessions (app_id, session_type, started_at, machine_id)
       VALUES (?, 'active', ?, ?)`
    )
    .run(appId, now, machineId)

  const dbId = result.lastInsertRowid as number
  return dbId
}

function closeSession(dbId: number, endedAt: number): void {
  const db = getDb()
  db.prepare<[number, number], void>(
    'UPDATE sessions SET ended_at = ? WHERE id = ?'
  ).run(endedAt, dbId)
}

export function tickActive(appId: number, now: number): void {
  _lastTickTime = now
  try {
    const interval = getPollInterval()
    const gapThreshold = interval * 2.5

    // Close sessions for apps that are no longer active
    for (const [existingAppId, session] of activeSessions.entries()) {
      if (existingAppId !== appId) {
        closeSession(session.dbId, session.lastTick + interval)
        activeSessions.delete(existingAppId)
      }
    }

    const existing = activeSessions.get(appId)

    if (!existing) {
      // No open session — start one
      const dbId = openSession(appId, now)
      activeSessions.set(appId, { dbId, startedAt: now, lastTick: now })
      return
    }

    if (now - existing.lastTick > gapThreshold) {
      // Gap detected — close old session, start new one
      closeSession(existing.dbId, existing.lastTick + interval)
      const dbId = openSession(appId, now)
      activeSessions.set(appId, { dbId, startedAt: now, lastTick: now })
      return
    }

    // Session still valid — update last tick in memory only (no DB write)
    existing.lastTick = now
  } catch (err) {
    console.error("[SessionManager] tickActive error:", err)
  }
}

// Called when the active window switches to an untracked app or disappears,
// so the previously active session is closed instead of leaking open.
export function endActiveSession(now: number): void {
  try {
    const interval = getPollInterval()
    for (const [appId, session] of activeSessions.entries()) {
      closeSession(session.dbId, session.lastTick + interval)
      activeSessions.delete(appId)
    }
  } catch (err) {
    console.error("[SessionManager] endActiveSession error:", err)
  }
}

// Called after a hard session wipe (DELETE FROM sessions) to discard stale
// in-memory session state.  The DB rows are already gone so we must NOT try to
// UPDATE them — just drop the map so the next tick opens fresh sessions.
export function resetSessionState(): void {
  activeSessions.clear()
}

// Called on app quit to close all open sessions
export function closeAllSessions(now: number): void {
  try {
    const db = getDb()
    const interval = getPollInterval()

    const closeOne = db.prepare<[number, number], void>(
      'UPDATE sessions SET ended_at = ? WHERE id = ?'
    )

    const closeAll = db.transaction(() => {
      for (const session of activeSessions.values()) {
        closeOne.run(Math.min(now, session.lastTick + interval), session.dbId)
      }
    })

    closeAll()
    activeSessions.clear()
  } catch (err) {
    console.error("[SessionManager] closeAllSessions error:", err)
  }
}

// Called on startup to close sessions left open by a previous crash.
// Normal shutdowns go through closeAllSessions() via before-quit, so this
// only has work to do when the process was force-killed or crashed.
export function repairOrphanedSessions(machineId: string, now: number): void {
  try {
    const db = getDb()
    // Prefer last_track_time (written at the start of every poll tick) over
    // MAX(apps.last_seen), which is only updated on new-app discovery and can
    // be days stale on an established system. Fall back to MAX(last_seen) for
    // databases that predate the last_track_time setting, then to `now`.
    const persisted = getSetting('last_track_time') as number | null
    let endTime: number
    if (persisted && persisted > 0) {
      endTime = persisted
    } else {
      const row = db.prepare<[], { last_seen: number } | undefined>(
        'SELECT MAX(last_seen) AS last_seen FROM apps'
      ).get()
      endTime = row?.last_seen ?? now
    }
    const result = db.prepare<[number, string], void>(
      "UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL AND machine_id = ?"
    ).run(endTime, machineId)
  } catch (err) {
    console.error("[SessionManager] repairOrphanedSessions error:", err)
  }
}

export function getLastTickTime(): number {
  return _lastTickTime
}

// Returns current active app ID (for IPC push)
export function getActiveAppId(): number | null {
  const entry = [...activeSessions.entries()][0]
  return entry ? entry[0] : null
}
