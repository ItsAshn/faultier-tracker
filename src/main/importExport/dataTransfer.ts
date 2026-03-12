import { dialog, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { z } from 'zod'
import { getDb, getSetting } from '../db/client'
import type { ExportPayload, ImportResult } from '@shared/types'

// ─── Zod schema for import validation ─────────────────────────────────────

const ExportedAppSchema = z.object({
  exe_name: z.string(),
  exe_path: z.string().nullable(),
  display_name: z.string(),
  group_name: z.string().nullable()
})

const ExportedGroupSchema = z.object({
  name: z.string(),
  is_manual: z.boolean().default(false)
})

const ExportedSessionSchema = z.object({
  app_exe: z.string(),
  app_path: z.string().nullable(),
  s: z.number(),
  e: z.number(),
  machine: z.string()
})

const ExportPayloadSchema = z.object({
  version: z.literal(2),
  exported_at: z.string(),
  machine_id: z.string(),
  apps: z.array(ExportedAppSchema),
  groups: z.array(ExportedGroupSchema),
  sessions: z.array(ExportedSessionSchema),
  settings: z.record(z.string())
})

// ─── Export ────────────────────────────────────────────────────────────────

export async function exportData(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const db = getDb()

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Faultier Tracker Data',
    defaultPath: path.join(
      app.getPath('documents'),
      `faultier-tracker-export-${new Date().toISOString().slice(0, 10)}.json`
    ),
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (canceled || !filePath) return { success: false }

  const machineId = getSetting('machine_id') as string
  const settings = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all()
  
  const apps = db.prepare<[], {
    id: number; exe_name: string; exe_path: string | null; display_name: string;
    group_id: number | null
  }>('SELECT id, exe_name, exe_path, display_name, group_id FROM apps').all()

  const groups = db.prepare<[], { id: number; name: string; is_manual: number }>(
    'SELECT id, name, is_manual FROM app_groups'
  ).all()

  const groupIdToName = new Map(groups.map((g) => [g.id, g.name]))

  const sessions = db.prepare<[], {
    app_id: number; started_at: number; ended_at: number | null; machine_id: string
  }>(
    'SELECT app_id, started_at, ended_at, machine_id FROM sessions WHERE ended_at IS NOT NULL'
  ).all()

  const appIdToExe = new Map(apps.map((a) => [a.id, { exe_name: a.exe_name, exe_path: a.exe_path }]))

  const payload: ExportPayload = {
    version: 2,
    exported_at: new Date().toISOString(),
    machine_id: machineId,
    apps: apps.map((a) => ({
      exe_name: a.exe_name,
      exe_path: a.exe_path,
      display_name: a.display_name,
      group_name: a.group_id ? (groupIdToName.get(a.group_id) ?? null) : null
    })),
    groups: groups.map((g) => ({
      name: g.name,
      is_manual: g.is_manual === 1
    })),
    sessions: sessions.map((s) => ({
      app_exe: appIdToExe.get(s.app_id)?.exe_name ?? '',
      app_path: appIdToExe.get(s.app_id)?.exe_path ?? null,
      s: s.started_at,
      e: s.ended_at ?? s.started_at,
      machine: s.machine_id
    })),
    settings: Object.fromEntries(settings.map((s) => [s.key, s.value]))
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2))
    return { success: true, filePath }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── CSV Export ───────────────────────────────────────────────────────────

export async function exportDataCsv(): Promise<{ success: boolean; filePath?: string; error?: string }> {
  const db = getDb()

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Faultier Tracker Data (CSV)',
    defaultPath: path.join(
      app.getPath('documents'),
      `faultier-tracker-export-${new Date().toISOString().slice(0, 10)}.csv`
    ),
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })

  if (canceled || !filePath) return { success: false }

  const apps = db.prepare<[], { id: number; display_name: string }>('SELECT id, display_name FROM apps').all()
  const appIdToName = new Map(apps.map((a) => [a.id, a.display_name]))

  const sessions = db.prepare<[], { app_id: number; started_at: number; ended_at: number | null }>(
    'SELECT app_id, started_at, ended_at FROM sessions WHERE ended_at IS NOT NULL'
  ).all()

  const dayMap = new Map<string, Map<number, number>>()

  for (const s of sessions) {
    const dateKey = new Date(s.started_at).toISOString().slice(0, 10)
    const ms = (s.ended_at ?? s.started_at) - s.started_at
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, new Map())
    const dayApps = dayMap.get(dateKey)!
    dayApps.set(s.app_id, (dayApps.get(s.app_id) ?? 0) + ms)
  }

  const rows: string[] = ['date,app_id,app_name,minutes']

  for (const [date, appMap] of dayMap) {
    for (const [appId, ms] of appMap) {
      const minutes = Math.round(ms / 60_000)
      if (minutes > 0) {
        rows.push(`${date},${appId},${appIdToName.get(appId) ?? 'Unknown'},${minutes}`)
      }
    }
  }

  try {
    fs.writeFileSync(filePath, rows.join('\n'))
    return { success: true, filePath }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Import ───────────────────────────────────────────────────────────────

export async function importData(): Promise<ImportResult> {
  const result: ImportResult = { appsAdded: 0, appsUpdated: 0, sessionsAdded: 0, duplicates: 0, errors: [] }

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Faultier Tracker Data',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })

  if (canceled || !filePaths || filePaths.length === 0) return result

  const filePath = filePaths[0]

  let payload: ExportPayload
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    payload = ExportPayloadSchema.parse(parsed)
  } catch (err) {
    if (err instanceof z.ZodError) {
      result.errors.push('Invalid export file format: ' + err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '))
    } else {
      result.errors.push('Failed to parse file: ' + (err instanceof Error ? err.message : String(err)))
    }
    return result
  }

  const db = getDb()

  db.transaction(() => {
    const groupNameToId = new Map<string, number>()

    // Import groups
    for (const group of payload.groups) {
      const existing = db
        .prepare<[string], { id: number } | undefined>(
          'SELECT id FROM app_groups WHERE lower(name) = lower(?)'
        )
        .get(group.name)

      if (existing) {
        groupNameToId.set(group.name.toLowerCase(), existing.id)
      } else {
        const r = db.prepare<[string, number, number], { lastInsertRowid: number | bigint }>(
          'INSERT INTO app_groups (name, is_manual, created_at) VALUES (?, ?, ?)'
        ).run(group.name, group.is_manual ? 1 : 0, Date.now())
        groupNameToId.set(group.name.toLowerCase(), r.lastInsertRowid as number)
      }
    }

    // Import apps
    for (const app of payload.apps) {
      const existing = db
        .prepare<[string, string | null], { id: number } | undefined>(
          'SELECT id FROM apps WHERE exe_name = ? AND (exe_path = ? OR (exe_path IS NULL AND ? IS NULL))'
        )
        .get(app.exe_name, app.exe_path)

      const groupId = app.group_name ? (groupNameToId.get(app.group_name.toLowerCase()) ?? null) : null

      if (existing) {
        result.appsUpdated++
        if (groupId !== null) {
          db.prepare<[number, number], void>('UPDATE apps SET group_id = ? WHERE id = ?').run(groupId, existing.id)
        }
      } else {
        result.appsAdded++
        const now = Date.now()
        db.prepare<[string, string | null, string, number | null, number, number], void>(
          'INSERT OR IGNORE INTO apps (exe_name, exe_path, display_name, group_id, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
          app.exe_name,
          app.exe_path,
          app.display_name,
          groupId,
          now,
          now
        )
      }
    }

    // Import sessions
    const resolveAppId = db.prepare<[string, string | null], { id: number } | undefined>(
      'SELECT id FROM apps WHERE exe_name = ? AND (exe_path = ? OR (exe_path IS NULL AND ? IS NULL))'
    )
    const checkDuplicate = db.prepare<[number, number, string], { count: number }>(
      'SELECT COUNT(*) as count FROM sessions WHERE app_id = ? AND started_at = ? AND machine_id = ?'
    )
    const insertSession = db.prepare<[number, number, number, string], void>(
      'INSERT INTO sessions (app_id, session_type, started_at, ended_at, machine_id) VALUES (?, \'active\', ?, ?, ?)'
    )

    for (const session of payload.sessions) {
      const appRow = resolveAppId.get(session.app_exe, session.app_path)
      if (!appRow) {
        result.errors.push(`App not found for session: ${session.app_exe}`)
        continue
      }

      const dup = checkDuplicate.get(appRow.id, session.s, session.machine)
      if ((dup?.count ?? 0) > 0) {
        result.duplicates++
        continue
      }

      insertSession.run(appRow.id, session.s, session.e, session.machine)
      result.sessionsAdded++
    }
  })()

  return result
}
