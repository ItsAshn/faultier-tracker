import { BrowserWindow, powerMonitor, Notification } from 'electron'
import { getDb, getSetting, upsertApp } from '../db/client'
import { getActiveApp, initActiveWin } from './activeWindow'
import { getRunningProcesses, initPsList } from './processScanner'
import { tickActive, tickRunning, endRunningSession, initSessionManager } from './sessionManager'
import { resolveGroup } from '../grouping/groupEngine'
import { updateTrayTooltip } from '../tray'
import { CHANNELS } from '@shared/channels'
import type { AppRecord, TickPayload } from '@shared/types'

let pollTimer: NodeJS.Timeout | null = null
let isRunning = false

// Track which app_ids were running in the previous tick
const prevRunningAppIds = new Set<number>()

// Break reminder tracking
let continuousActiveMs = 0
let lastBreakNotifAt = 0

export async function startTracker(): Promise<void> {
  const machineId = getSetting('machine_id') as string
  initSessionManager(machineId)

  await initActiveWin()
  await initPsList()

  isRunning = true
  schedulePoll()
  console.log('[Tracker] Started')
}

export function stopTracker(): void {
  isRunning = false
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
  console.log('[Tracker] Stopped')
}

function schedulePoll(): void {
  if (!isRunning) return
  const interval = (getSetting('poll_interval_ms') as number) ?? 5000
  pollTimer = setTimeout(async () => {
    await pollTick()
    schedulePoll()
  }, interval)
}

async function pollTick(): Promise<void> {
  const now = Date.now()

  try {
    const idleThreshold = (getSetting('idle_threshold_ms') as number) ?? 300000
    const idleSecs = powerMonitor.getSystemIdleTime()
    const isIdle = idleSecs * 1000 >= idleThreshold

    const [activeApp, runningProcesses] = await Promise.all([
      getActiveApp(),
      getRunningProcesses()
    ])

    // ── Tracked apps lookup ──────────────────────────────────────────
    const db = getDb()
    const trackedMode = (getSetting('tracking_mode') as string) ?? 'blacklist'

    // Build a map of exe_name → app record for running processes
    const currentRunningIds = new Set<number>()

    for (const proc of runningProcesses) {
      // For blacklist mode: track everything not explicitly excluded
      // For whitelist mode: track only explicitly included apps
      const appRow = db
        .prepare<[string], { id: number; is_tracked: number } | undefined>(
          'SELECT id, is_tracked FROM apps WHERE exe_name = ?'
        )
        .get(proc.exeName)

      if (appRow) {
        const shouldTrack =
          trackedMode === 'blacklist' ? appRow.is_tracked === 1 : appRow.is_tracked === 1

        if (shouldTrack) {
          currentRunningIds.add(appRow.id)
          tickRunning(appRow.id, now)
        }
      } else if (trackedMode === 'blacklist') {
        // Auto-discover new apps in blacklist mode
        const displayName = deriveDisplayName(proc.exeName)
        const appId = upsertApp(proc.exeName, null, displayName, now)
        resolveGroup(proc.exeName, null).then((groupId) => {
          if (groupId !== null) {
            db.prepare<[number, number], void>('UPDATE apps SET group_id = ? WHERE id = ?').run(
              groupId,
              appId
            )
          }
        })
        // Notify renderer of the newly discovered app
        const newApp = db
          .prepare<[number], AppRecord>('SELECT * FROM apps WHERE id = ?')
          .get(appId)
        if (newApp) {
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) win.webContents.send(CHANNELS.TRACKING_APP_SEEN, newApp)
          })
        }
        currentRunningIds.add(appId)
        tickRunning(appId, now)
      }
    }

    // Close sessions for processes that stopped running
    for (const prevId of prevRunningAppIds) {
      if (!currentRunningIds.has(prevId)) {
        endRunningSession(prevId, now)
      }
    }
    prevRunningAppIds.clear()
    for (const id of currentRunningIds) prevRunningAppIds.add(id)

    // ── Active window ────────────────────────────────────────────────
    let activeAppId: number | null = null
    let activeDisplayName: string | null = null

    if (activeApp) {
      // Single query fetches all fields we need for this app — avoids 3 sequential lookups
      let appRow = db
        .prepare<[string], { id: number; display_name: string; is_tracked: number; exe_path: string | null; group_id: number | null } | undefined>(
          'SELECT id, display_name, is_tracked, exe_path, group_id FROM apps WHERE exe_name = ?'
        )
        .get(activeApp.exeName)

      let appId: number
      if (!appRow) {
        const displayName = deriveDisplayName(activeApp.exeName)
        appId = upsertApp(activeApp.exeName, activeApp.exePath, displayName, now)
        resolveGroup(activeApp.exeName, activeApp.exePath).then((groupId) => {
          if (groupId !== null) {
            db.prepare<[number, number], void>('UPDATE apps SET group_id = ? WHERE id = ?').run(
              groupId,
              appId
            )
          }
        })
        // Notify renderer of the newly discovered app (if not already sent from process scan)
        if (!currentRunningIds.has(appId)) {
          const newApp = db
            .prepare<[number], AppRecord>('SELECT * FROM apps WHERE id = ?')
            .get(appId)
          if (newApp) {
            BrowserWindow.getAllWindows().forEach((win) => {
              if (!win.isDestroyed()) win.webContents.send(CHANNELS.TRACKING_APP_SEEN, newApp)
            })
          }
        }
        // Re-fetch so we have a full record for the logic below
        appRow = db
          .prepare<[string], { id: number; display_name: string; is_tracked: number; exe_path: string | null; group_id: number | null } | undefined>(
            'SELECT id, display_name, is_tracked, exe_path, group_id FROM apps WHERE exe_name = ?'
          )
          .get(activeApp.exeName)
      } else {
        appId = appRow.id
      }

      if (appRow && appRow.is_tracked === 1 && !isIdle) {
        tickActive(appId, activeApp.windowTitle, now)
        // If the focused app wasn't detected in the process scan (e.g. UWP/system
        // processes), still record it as running so focused ≤ running always holds.
        if (!currentRunningIds.has(appId)) {
          tickRunning(appId, now)
          // Track it in prevRunningAppIds so endRunningSession fires next tick
          // if it's still not in the process list, rather than waiting for gap detection.
          prevRunningAppIds.add(appId)
        }
        activeAppId = appId
        activeDisplayName = appRow.display_name

        // Update exe_path if we now have it; if this is the first time we get
        // the path AND the app has no group yet, re-run group resolution so
        // Steam library path matching can kick in.
        if (activeApp.exePath && !appRow.exe_path) {
          db.prepare<[string, number], void>('UPDATE apps SET exe_path = ? WHERE id = ?')
            .run(activeApp.exePath, appId)

          if (!appRow.group_id) {
            resolveGroup(activeApp.exeName, activeApp.exePath).then((groupId) => {
              if (groupId !== null) {
                db.prepare<[number, number], void>('UPDATE apps SET group_id = ? WHERE id = ?').run(
                  groupId,
                  appId
                )
              }
            })
          }
        }
      }
    }

    // ── Push tick to renderer ────────────────────────────────────────
    const payload: TickPayload = {
      active_app:
        activeAppId && activeDisplayName
          ? {
              app_id: activeAppId,
              exe_name: activeApp!.exeName,
              display_name: activeDisplayName
            }
          : null,
      timestamp: now,
      is_idle: isIdle
    }

    updateTrayTooltip(activeDisplayName, isIdle)

    // ── Break reminder ───────────────────────────────────────────────
    const breakReminderMins = (getSetting('break_reminder_mins') as number) ?? 0
    const interval = (getSetting('poll_interval_ms') as number) ?? 5000
    if (breakReminderMins > 0) {
      if (activeAppId && !isIdle) {
        continuousActiveMs += interval
        const breakThresholdMs = breakReminderMins * 60_000
        if (
          continuousActiveMs >= breakThresholdMs &&
          Date.now() - lastBreakNotifAt > breakThresholdMs
        ) {
          lastBreakNotifAt = Date.now()
          const h = Math.floor(continuousActiveMs / 3_600_000)
          const m = Math.floor((continuousActiveMs % 3_600_000) / 60_000)
          const timeStr = h > 0 ? `${h}h ${m}m` : `${m}m`
          new Notification({
            title: 'Time for a break!',
            body: `You've been active for ${timeStr}. Consider taking a short break.`,
          }).show()
        }
      } else {
        // Reset when idle or no active app
        continuousActiveMs = 0
      }
    } else {
      continuousActiveMs = 0
    }

    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send(CHANNELS.TRACKING_TICK, payload)
      }
    })
  } catch (err) {
    console.error('[Tracker] Poll error:', err)
  }
}

function deriveDisplayName(exeName: string): string {
  return exeName
    .replace(/\.exe$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}
