import initSqlJs from 'sql.js'
import type { Database as SqlJsDatabase } from 'sql.js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { runMigrations, seedDefaults } from './migrations'

// ─── Compatibility wrapper (mimics better-sqlite3 API) ─────────────────────

export interface DbCompat {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare<P extends unknown[] = unknown[], R = any>(sql: string): {
    get(...params: P): R | undefined
    all(...params: P): R[]
    run(...params: P): { lastInsertRowid: number | bigint }
  }
  exec(sql: string): void
  transaction<T>(fn: () => T): () => T
  pragma(str: string): void
  close(): void
}

function wrapDb(raw: SqlJsDatabase): DbCompat {
  return {
    prepare(sql: string) {
      return {
        get(...params: unknown[]) {
          const stmt = raw.prepare(sql)
          stmt.bind(params)
          const row = stmt.step() ? stmt.getAsObject() : undefined
          stmt.free()
          return row as any
        },
        all(...params: unknown[]) {
          const stmt = raw.prepare(sql)
          stmt.bind(params)
          const rows: unknown[] = []
          while (stmt.step()) rows.push(stmt.getAsObject())
          stmt.free()
          return rows as any[]
        },
        run(...params: unknown[]) {
          const stmt = raw.prepare(sql)
          stmt.run(params)
          const r = raw.exec('SELECT last_insert_rowid()')
          const lastInsertRowid = (r[0]?.values?.[0]?.[0] as number) ?? 0
          stmt.free()
          return { lastInsertRowid }
        }
      }
    },

    exec(sql: string) {
      raw.exec(sql)
    },

    transaction<T>(fn: () => T): () => T {
      return () => {
        raw.exec('BEGIN')
        try {
          const result = fn()
          raw.exec('COMMIT')
          return result
        } catch (e) {
          raw.exec('ROLLBACK')
          throw e
        }
      }
    },

    pragma(str: string) {
      if (str.startsWith('journal_mode')) return
      try { raw.exec(`PRAGMA ${str}`) } catch { /* ignore */ }
    },

    close() {
      persistDb()
      raw.close()
    }
  }
}

// ─── Singleton state ────────────────────────────────────────────────────────

let _db: DbCompat | null = null
let _rawDb: SqlJsDatabase | null = null
let _dbPath = ''
let _saveTimer: NodeJS.Timeout | null = null

export function getDb(): DbCompat {
  if (!_db) throw new Error('Database not initialized. Call openDb() first.')
  return _db
}

export async function openDb(): Promise<DbCompat> {
  if (_db) return _db

  const userDataPath = app.getPath('userData')
  fs.mkdirSync(userDataPath, { recursive: true })
  _dbPath = path.join(userDataPath, 'data.db')

  // Resolve WASM file relative to current __dirname (out/main/)
  const wasmPath = path.resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm')
  const SQL = await initSqlJs({ locateFile: () => wasmPath })

  if (fs.existsSync(_dbPath)) {
    const buffer = fs.readFileSync(_dbPath)
    _rawDb = new SQL.Database(buffer)
  } else {
    _rawDb = new SQL.Database()
  }

  _db = wrapDb(_rawDb)
  _db.pragma('foreign_keys = ON')

  runMigrations(_db)
  seedDefaults(_db)

  // Auto-save every 30 seconds
  _saveTimer = setInterval(persistDb, 30_000)

  console.log('[DB] Opened:', _dbPath)
  return _db
}

export function persistDb(): void {
  if (!_rawDb || !_dbPath) return
  const data = _rawDb.export()
  fs.writeFileSync(_dbPath, Buffer.from(data))
}

export function closeDb(): void {
  if (_saveTimer) { clearInterval(_saveTimer); _saveTimer = null }
  persistDb()
  _rawDb?.close()
  _rawDb = null
  _db = null
  console.log('[DB] Closed')
}

// ─── Settings helpers ──────────────────────────────────────────────────────

export function getSetting(key: string): unknown {
  const db = getDb()
  const row = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key)
  return row ? JSON.parse(row.value) : null
}

export function setSetting(key: string, value: unknown): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
}

export function getAllSettings(): Record<string, unknown> {
  const db = getDb()
  const rows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all()
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
}

// ─── App helpers ───────────────────────────────────────────────────────────

export interface RawApp {
  id: number
  exe_name: string
  exe_path: string | null
  display_name: string
  group_id: number | null
  is_tracked: number
  icon_cache_path: string | null
  custom_image_path: string | null
  description: string
  notes: string
  tags: string
  first_seen: number
  last_seen: number
}

export function upsertApp(exeName: string, exePath: string | null, displayName: string, now: number): number {
  const db = getDb()
  const existing = db
    .prepare<[string, string | null, string | null], { id: number }>(
      'SELECT id FROM apps WHERE exe_name = ? AND (exe_path = ? OR (exe_path IS NULL AND ? IS NULL))'
    )
    .get(exeName, exePath, exePath)

  if (existing) {
    db.prepare('UPDATE apps SET last_seen = ? WHERE id = ?').run(now, existing.id)
    return existing.id
  }

  const result = db.prepare(
    'INSERT INTO apps (exe_name, exe_path, display_name, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)'
  ).run(exeName, exePath, displayName, now, now)

  return result.lastInsertRowid as number
}
