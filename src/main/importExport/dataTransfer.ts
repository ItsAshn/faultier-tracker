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
  group_name: z.string().nullable(),
  description: z.string().default(''),
  notes: z.string().default(''),
  tags: z.array(z.string()).default([])
})

const ExportedGroupSchema = z.object({
  name: z.string(),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  is_manual: z.boolean().default(false)
})

const ExportedSessionSchema = z.object({
  app_exe: z.string(),
  app_path: z.string().nullable(),
  type: z.enum(['active', 'running']),
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
    group_id: number | null; description: string; notes: string; tags: string
  }>('SELECT id, exe_name, exe_path, display_name, group_id, description, notes, tags FROM apps').all()

  const groups = db.prepare<[], { id: number; name: string; description: string; tags: string; is_manual: number }>(
    'SELECT id, name, description, tags, is_manual FROM app_groups'
  ).all()

  const groupIdToName = new Map(groups.map((g) => [g.id, g.name]))

  const sessions = db.prepare<[], {
    app_id: number; session_type: string; started_at: number; ended_at: number | null; machine_id: string
  }>(
    'SELECT app_id, session_type, started_at, ended_at, machine_id FROM sessions WHERE ended_at IS NOT NULL'
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
      group_name: a.group_id ? (groupIdToName.get(a.group_id) ?? null) : null,
      description: a.description,
      notes: a.notes,
      tags: JSON.parse(a.tags ?? '[]')
    })),
    groups: groups.map((g) => ({
      name: g.name,
      description: g.description,
      tags: JSON.parse(g.tags ?? '[]'),
      is_manual: g.is_manual === 1
    })),
    sessions: sessions
      .filter((s) => s.ended_at !== null)
      .map((s) => {
        const appInfo = appIdToExe.get(s.app_id)
        return {
          app_exe: appInfo?.exe_name ?? '',
          app_path: appInfo?.exe_path ?? null,
          type: s.session_type as 'active' | 'running',
          s: s.started_at,
          e: s.ended_at!,
          machine: s.machine_id
        }
      })
      .filter((s) => s.app_exe !== ''),
    settings: Object.fromEntries(
      settings
        .filter((s) => s.key !== 'machine_id')
        .map((s) => [s.key, s.value])
    )
  }

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8')
  return { success: true, filePath }
}

// ─── Import ────────────────────────────────────────────────────────────────

export async function importData(): Promise<ImportResult & { error?: string }> {
  const result: ImportResult = { appsAdded: 0, appsUpdated: 0, sessionsAdded: 0, duplicates: 0, errors: [] }

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Faultier Tracker Data',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })

  if (canceled || !filePaths[0]) return result

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'))
  } catch {
    return { ...result, errors: ['Failed to read or parse file.'] }
  }

  const parsed = ExportPayloadSchema.safeParse(raw)
  if (!parsed.success) {
    return { ...result, errors: [`Invalid file format: ${parsed.error.message}`] }
  }

  const payload = parsed.data
  const db = getDb()

  const groupNameToId = new Map<string, number>()

  db.transaction(() => {
    // Import groups
    for (const group of payload.groups) {
      const existing = db
        .prepare<[string], { id: number } | undefined>(
          'SELECT id FROM app_groups WHERE lower(name) = lower(?)'
        )
        .get(group.name)

      if (existing) {
        groupNameToId.set(group.name.toLowerCase(), existing.id)
        // Update description if empty
        db.prepare<[string, string, number], void>(
          'UPDATE app_groups SET description = ? WHERE id = ? AND description = ?'
        ).run(group.description, existing.id, '')
      } else {
        const r = db.prepare<[string, string, string, number, number], { lastInsertRowid: number | bigint }>(
          'INSERT INTO app_groups (name, description, tags, is_manual, created_at) VALUES (?, ?, ?, ?, ?)'
        ).run(group.name, group.description, JSON.stringify(group.tags), group.is_manual ? 1 : 0, Date.now())
        groupNameToId.set(group.name.toLowerCase(), r.lastInsertRowid as number)
      }
    }

    // Import apps
    for (const app of payload.apps) {
      const existing = db
        .prepare<[string, string | null], { id: number; description: string; tags: string } | undefined>(
          'SELECT id, description, tags FROM apps WHERE exe_name = ? AND (exe_path = ? OR (exe_path IS NULL AND ? IS NULL))'
        )
        .get(app.exe_name, app.exe_path, app.exe_path)

      const groupId = app.group_name ? (groupNameToId.get(app.group_name.toLowerCase()) ?? null) : null

      if (existing) {
        result.appsUpdated++
        // Merge tags (union)
        const existingTags: string[] = JSON.parse(existing.tags ?? '[]')
        const merged = Array.from(new Set([...existingTags, ...app.tags]))
        db.prepare<[string, string, number], void>(
          'UPDATE apps SET tags = ?, description = CASE WHEN description = "" THEN ? ELSE description END WHERE id = ?'
        ).run(JSON.stringify(merged), app.description, existing.id)
        if (groupId !== null) {
          db.prepare<[number, number], void>('UPDATE apps SET group_id = ? WHERE id = ?').run(groupId, existing.id)
        }
      } else {
        result.appsAdded++
        const now = Date.now()
        db.prepare<[string, string | null, string, number | null, string, string, string, number, number], void>(
          `INSERT OR IGNORE INTO apps
           (exe_name, exe_path, display_name, group_id, description, notes, tags, first_seen, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          app.exe_name,
          app.exe_path,
          app.display_name,
          groupId,
          app.description,
          app.notes,
          JSON.stringify(app.tags),
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
    const insertSession = db.prepare<[number, string, number, number, string], void>(
      'INSERT INTO sessions (app_id, session_type, started_at, ended_at, machine_id) VALUES (?, ?, ?, ?, ?)'
    )

    for (const session of payload.sessions) {
      const appRow = resolveAppId.get(session.app_exe, session.app_path, session.app_path)
      if (!appRow) {
        result.errors.push(`App not found for session: ${session.app_exe}`)
        continue
      }

      const dup = checkDuplicate.get(appRow.id, session.s, session.machine)
      if ((dup?.count ?? 0) > 0) {
        result.duplicates++
        continue
      }

      insertSession.run(appRow.id, session.type, session.s, session.e, session.machine)
      result.sessionsAdded++
    }
  })()

  return result
}
