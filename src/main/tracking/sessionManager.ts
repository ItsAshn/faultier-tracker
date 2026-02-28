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

export function initSessionManager(mid: string): void {
  machineId = mid
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

  return result.lastInsertRowid as number
}

function closeSession(dbId: number, endedAt: number): void {
  const db = getDb()
  db.prepare<[number, number], void>(
    'UPDATE sessions SET ended_at = ? WHERE id = ?'
  ).run(endedAt, dbId)
}

export function tickActive(appId: number, windowTitle: string, now: number): void {
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
    const dbId = openSession(appId, 'active', now, windowTitle)
    activeSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle })
    return
  }

  if (now - existing.lastTick > gapThreshold) {
    // Gap detected — close old session, start new one
    closeSession(existing.dbId, existing.lastTick + interval)
    const dbId = openSession(appId, 'active', now, windowTitle)
    activeSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle })
    return
  }

  // Session still valid — update last tick in memory only (no DB write)
  existing.lastTick = now
  existing.windowTitle = windowTitle
}

export function tickRunning(appId: number, now: number): void {
  const interval = getPollInterval()
  const gapThreshold = interval * 2.5

  const existing = runningSessions.get(appId)

  if (!existing) {
    const dbId = openSession(appId, 'running', now, null)
    runningSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle: null })
    return
  }

  if (now - existing.lastTick > gapThreshold) {
    closeSession(existing.dbId, existing.lastTick + interval)
    const dbId = openSession(appId, 'running', now, null)
    runningSessions.set(appId, { dbId, startedAt: now, lastTick: now, windowTitle: null })
    return
  }

  existing.lastTick = now
}

// Called when a process is no longer running
export function endRunningSession(appId: number, now: number): void {
  const session = runningSessions.get(appId)
  if (session) {
    closeSession(session.dbId, now)
    runningSessions.delete(appId)
  }
}

// Called on app quit to close all open sessions
export function closeAllSessions(now: number): void {
  const db = getDb()
  const interval = getPollInterval()

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
}

// Returns current active app ID (for IPC push)
export function getActiveAppId(): number | null {
  const entry = [...activeSessions.entries()][0]
  return entry ? entry[0] : null
}
