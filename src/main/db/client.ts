import initSqlJs from 'sql.js'
import type { Database as SqlJsDatabase, Statement } from 'sql.js'
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
  // Cache compiled statements to avoid recompiling the same SQL repeatedly
  const stmtCache = new Map<string, Statement>()

  function getStmt(sql: string): Statement {
    let stmt = stmtCache.get(sql)
    if (!stmt) {
      stmt = raw.prepare(sql)
      stmtCache.set(sql, stmt)
    }
    return stmt
  }

  return {
    prepare(sql: string) {
      return {
        get(...params: unknown[]) {
          const stmt = getStmt(sql)
          stmt.bind(params)
          const row = stmt.step() ? stmt.getAsObject() : undefined
          stmt.reset()
          return row as any
        },
        all(...params: unknown[]) {
          const stmt = getStmt(sql)
          stmt.bind(params)
          const rows: unknown[] = []
          while (stmt.step()) rows.push(stmt.getAsObject())
          stmt.reset()
          return rows as any[]
        },
        run(...params: unknown[]) {
          const stmt = getStmt(sql)
          stmt.run(params)
          const r = raw.exec('SELECT last_insert_rowid()')
          const lastInsertRowid = (r[0]?.values?.[0]?.[0] as number) ?? 0
          stmt.reset()
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
      // Free all cached compiled statements before closing the DB
      for (const stmt of stmtCache.values()) {
        try { stmt.free() } catch { /* ignore */ }
      }
      stmtCache.clear()
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
let _isSaving = false

// In-memory settings cache — populated on first getSetting() call, invalidated on set
let _settingsCache: Map<string, unknown> | null = null

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

  // Auto-save every 30 seconds using async I/O to avoid blocking the main thread
  _saveTimer = setInterval(async () => {
    if (!_rawDb || !_dbPath || _isSaving) return
    _isSaving = true
    try {
      const data = _rawDb.export()
      await fs.promises.writeFile(_dbPath, Buffer.from(data))
    } catch (err) {
      console.error('[DB] Auto-save failed:', err)
    } finally {
      _isSaving = false
    }
  }, 30_000)

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
  _settingsCache = null
  _db?.close()  // frees statement cache, persists DB, closes raw
  _rawDb = null
  _db = null
  console.log('[DB] Closed')
}

// ─── Settings helpers ──────────────────────────────────────────────────────

function loadSettingsCache(): void {
  const db = getDb()
  const rows = db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings').all()
  _settingsCache = new Map(rows.map((r) => [r.key, JSON.parse(r.value)]))
}

export function getSetting(key: string): unknown {
  if (!_settingsCache) loadSettingsCache()
  return _settingsCache!.get(key) ?? null
}

export function setSetting(key: string, value: unknown): void {
  const db = getDb()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value))
  // Update in-memory cache so next getSetting() is instant
  if (_settingsCache) _settingsCache.set(key, value)
}

export function getAllSettings(): Record<string, unknown> {
  if (!_settingsCache) loadSettingsCache()
  return Object.fromEntries(_settingsCache!.entries())
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
