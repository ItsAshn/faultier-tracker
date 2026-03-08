import { getDb, getSetting } from '../db/client'

interface OpenSession {
  dbId: number
  startedAt: number
  lastTick: number
  windowTitle: string | null
}

// In-memory maps for currently open sessions
const activeSessions = new Map<number, OpenSession>()   // app_id → session
const runningSessions = new Map<number, OpenSession>()  // app_id → session

let machineId = ''
let _lastTickTime = 0

export function initSessionManager(mid: string): void {
  machineId = mid
  console.log(`[SessionManager] initialized with machineId=${mid}`)
}

function getPollInterval(): number {
  const raw = getSetting('poll_interval_ms')
  return typeof raw === 'number' ? raw : 5000
}

function openSession(
  appId: number,
  type: 'active' | 'running',
  now: number,
  windowTitle: string | null
): number {
  const db = getDb()
  const recordTitles = getSetting('record_titles') !== false
  const result = db
    .prepare<[number, string, number, string | null, string], { lastInsertRowid: number | bigint }>(
      `INSERT INTO sessions (app_id, session_type, started_at, window_title, machine_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(appId, type, now, recordTitles ? windowTitle : null, machineId)

  const dbId = result.lastInsertRowid as number
  console.log(`[SessionManager] opened ${type} session id=${dbId} for app=${appId}${windowTitle ? ` title="${windowTitle}"` : ''}`)
  return dbId
}

function closeSession(dbId: number, endedAt: number): void {
  const db = getDb()
  db.prepare<[number, number], void>(
    'UPDATE sessions SET ended_at = ? WHERE id = ?'
  ).run(endedAt, dbId)
  console.log(`[SessionManager] closed session id=${dbId} endedAt=${new Date(endedAt).toISOString()}`)
}

export function tickActive(appId: number, windowTitle: string, now: number): void {
  _lastTickTime = now
  try {
    const interval = getPollInterval()
    const gapThreshold = interval * 2.5

    // Close sessions for apps that are no longer active
    for (const [existingAppId, session] of activeSessions.entries()) {
      if (existingAppId !== appId) {
        console.log(`[SessionManager] tickActive: closing stale active session for app=${existingAppId} (new active=${appId})`)
        closeSession(session.dbId, session.lastTick + interval)
        activeSessions.delete(existingAppId)
      }
    }

    const existing = activeSessions.get(appId)

    if (!existing) {
      // No open session — start one
      const dbId = openSession(appId, 'active', now, windowTitle)
      activeSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle })
      return
    }

    if (now - existing.lastTick > gapThreshold) {
      // Gap detected — close old session, start new one
      console.log(`[SessionManager] tickActive: gap detected for app=${appId} (gap=${now - existing.lastTick}ms > threshold=${gapThreshold}ms)`)
      closeSession(existing.dbId, existing.lastTick + interval)
      const dbId = openSession(appId, 'active', now, windowTitle)
      activeSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle })
      return
    }

    // Session still valid — update last tick in memory only (no DB write)
    existing.lastTick = now
    existing.windowTitle = windowTitle
  } catch (err) {
    console.error("[SessionManager] tickActive error:", err)
  }
}

export function tickRunning(appId: number, now: number): void {
  _lastTickTime = now
  try {
    const interval = getPollInterval()
    const gapThreshold = interval * 2.5

    const existing = runningSessions.get(appId)

    if (!existing) {
      const dbId = openSession(appId, 'running', now, null)
      runningSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle: null })
      return
    }

    if (now - existing.lastTick > gapThreshold) {
      console.log(`[SessionManager] tickRunning: gap detected for app=${appId} (gap=${now - existing.lastTick}ms > threshold=${gapThreshold}ms)`)
      closeSession(existing.dbId, existing.lastTick + interval)
      const dbId = openSession(appId, 'running', now, null)
      runningSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle: null })
      return
    }

    existing.lastTick = now
  } catch (err) {
    console.error("[SessionManager] tickRunning error:", err)
  }
}

// Called when the active window switches to an untracked app or disappears,
// so the previously active session is closed instead of leaking open.
export function endActiveSession(now: number): void {
  try {
    const interval = getPollInterval()
    for (const [appId, session] of activeSessions.entries()) {
      console.log(`[SessionManager] endActiveSession: closing active session id=${session.dbId} for app=${appId}`)
      closeSession(session.dbId, session.lastTick + interval)
      activeSessions.delete(appId)
    }
  } catch (err) {
    console.error("[SessionManager] endActiveSession error:", err)
  }
}

// Called when a process is no longer running
export function endRunningSession(appId: number, now: number): void {
  _lastTickTime = now
  try {
    const session = runningSessions.get(appId)
    if (session) {
      console.log(`[SessionManager] endRunningSession: closing running session id=${session.dbId} for app=${appId}`)
      closeSession(session.dbId, now)
      runningSessions.delete(appId)
    }
  } catch (err) {
    console.error("[SessionManager] endRunningSession error:", err)
  }
}

// Called on app quit to close all open sessions
export function closeAllSessions(now: number): void {
  try {
    const db = getDb()
    const interval = getPollInterval()

    console.log(`[SessionManager] closeAllSessions: closing ${activeSessions.size} active + ${runningSessions.size} running session(s)`)

    const closeOne = db.prepare<[number, number], void>(
      'UPDATE sessions SET ended_at = ? WHERE id = ?'
    )

    const closeAll = db.transaction(() => {
      for (const session of activeSessions.values()) {
        closeOne.run(Math.min(now, session.lastTick + interval), session.dbId)
      }
      for (const session of runningSessions.values()) {
        closeOne.run(Math.min(now, session.lastTick + interval), session.dbId)
      }
    })

    closeAll()
    activeSessions.clear()
    runningSessions.clear()
    console.log(`[SessionManager] closeAllSessions: done`)
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
    // Use the most recent app activity timestamp as a proxy for when the last
    // tick ran before the crash. This is much more accurate than using `now`
    // (restart time), which would inflate durations by the time the app was closed.
    const row = db.prepare<[], { last_seen: number } | undefined>(
      'SELECT MAX(last_seen) AS last_seen FROM apps'
    ).get()
    const endTime = row?.last_seen ?? now
    const result = db.prepare<[number, string], void>(
      'UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL AND machine_id = ?'
    ).run(endTime, machineId)
    console.log(`[SessionManager] repairOrphanedSessions: closed ${(result as any).changes ?? '?'} orphaned session(s) using endTime=${new Date(endTime).toISOString()}`)
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
