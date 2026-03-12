import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase, Statement } from "sql.js";
import { app } from "electron";
import path from "path";
import fs from "fs";
import { runMigrations, seedDefaults } from "./migrations";

// ─── Compatibility wrapper (mimics better-sqlite3 API) ─────────────────────

export interface DbCompat {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare<P extends unknown[] = unknown[], R = any>(
    sql: string,
  ): {
    get(...params: P): R | undefined;
    all(...params: P): R[];
    run(...params: P): { lastInsertRowid: number | bigint };
  };
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  pragma(str: string): void;
  close(): void;
}

function wrapDb(raw: SqlJsDatabase): DbCompat {
  // Cache compiled statements to avoid recompiling the same SQL repeatedly
  const stmtCache = new Map<string, Statement>();
  let _closed = false;

  function getStmt(sql: string): Statement {
    if (_closed) throw new Error("Database is closed");
    let stmt = stmtCache.get(sql);
    if (!stmt) {
      stmt = raw.prepare(sql);
      stmtCache.set(sql, stmt);
    }
    return stmt;
  }

  return {
    prepare(sql: string) {
      return {
        get(...params: unknown[]) {
          const stmt = getStmt(sql);
          try {
            stmt.bind(params);
            const row = stmt.step() ? stmt.getAsObject() : undefined;
            return row as any;
          } finally {
            stmt.reset();
          }
        },
        all(...params: unknown[]) {
          const stmt = getStmt(sql);
          try {
            stmt.bind(params);
            const rows: unknown[] = [];
            while (stmt.step()) rows.push(stmt.getAsObject());
            return rows as any[];
          } finally {
            stmt.reset();
          }
        },
        run(...params: unknown[]) {
          const stmt = getStmt(sql);
          try {
            stmt.run(params);
            const r = raw.exec("SELECT last_insert_rowid()");
            const lastInsertRowid = (r[0]?.values?.[0]?.[0] as number) ?? 0;
            return { lastInsertRowid };
          } finally {
            stmt.reset();
          }
        },
      };
    },

    exec(sql: string) {
      raw.exec(sql);
    },

    transaction<T>(fn: () => T): () => T {
      return () => {
        raw.exec("BEGIN");
        try {
          const result = fn();
          raw.exec("COMMIT");
          return result;
        } catch (e) {
          raw.exec("ROLLBACK");
          throw e;
        }
      };
    },

    pragma(str: string) {
      if (str.startsWith("journal_mode")) return;
      try {
        raw.exec(`PRAGMA ${str}`);
      } catch {
        /* ignore */
      }
    },

    close() {
      // Mark closed first so any concurrent getStmt() calls fail fast
      // instead of operating on freed WASM statement objects.
      _closed = true;
      // Free all cached compiled statements before closing the DB
      for (const stmt of stmtCache.values()) {
        try {
          stmt.free();
        } catch {
          /* ignore */
        }
      }
      stmtCache.clear();
      persistDb();
      raw.close();
    },
  };
}

// ─── Singleton state ────────────────────────────────────────────────────────

let _db: DbCompat | null = null;
let _rawDb: SqlJsDatabase | null = null;
let _dbPath = "";
let _saveTimer: NodeJS.Timeout | null = null;
let _isSaving = false;
let _dbWasCorrupted = false;

// In-memory settings cache — populated on first getSetting() call, invalidated on set
let _settingsCache: Map<string, unknown> | null = null;

export function getDb(): DbCompat {
  if (!_db) throw new Error("Database not initialized. Call openDb() first.");
  return _db;
}

export function wasDbCorrupted(): boolean {
  return _dbWasCorrupted;
}

export async function openDb(): Promise<DbCompat> {
  if (_db) return _db;

  const userDataPath = app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });
  _dbPath = path.join(userDataPath, "data.db");

  // Resolve WASM file relative to current __dirname (out/main/)
  const wasmPath = path.resolve(
    __dirname,
    "../../node_modules/sql.js/dist/sql-wasm.wasm",
  );
  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  if (fs.existsSync(_dbPath)) {
    try {
      const buffer = await fs.promises.readFile(_dbPath);
      _rawDb = new SQL.Database(buffer);
    } catch (err) {
      console.error("[DB] Corrupted database file detected, backing up and creating fresh:", err);
      const backupPath = `${_dbPath}.corrupted.${Date.now()}`;
      fs.renameSync(_dbPath, backupPath);
      _rawDb = new SQL.Database();
      _dbWasCorrupted = true;
    }
  } else {
    _rawDb = new SQL.Database();
  }

  _db = wrapDb(_rawDb);
  _db.pragma("foreign_keys = ON");

  runMigrations(_db);
  seedDefaults(_db);

  // Auto-save every 30 seconds using async I/O to avoid blocking the main thread
  _saveTimer = setInterval(async () => {
    if (!_rawDb || !_dbPath || _isSaving) return;
    _isSaving = true;
    try {
      const data = _rawDb.export();
      await fs.promises.writeFile(_dbPath, Buffer.from(data));
    } catch (err) {
      console.error("[DB] Auto-save failed:", err);
    } finally {
      _isSaving = false;
    }
  }, 30_000);

  console.log("[DB] Opened:", _dbPath);
  return _db;
}

export function persistDb(): void {
  if (!_rawDb || !_dbPath) return;
  const data = _rawDb.export();
  fs.writeFileSync(_dbPath, Buffer.from(data));
}

export function closeDb(): void {
  if (_saveTimer) {
    clearInterval(_saveTimer);
    _saveTimer = null;
  }
  _settingsCache = null;
  // Null out _db before calling close() so any concurrent IPC that calls
  // getDb() gets "Database not initialized" rather than operating on a
  // half-closed wrapper with freed WASM statement objects.
  // Keep _rawDb alive until after db.close() since persistDb() needs it.
  const db = _db;
  _db = null;
  db?.close(); // sets _closed flag, frees statement cache, persists DB, closes raw
  _rawDb = null;
  console.log("[DB] Closed");
}

export function resetDbData(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM group_rules;
    DELETE FROM apps;
    DELETE FROM app_groups;
    DELETE FROM settings;
  `);
  _settingsCache = null;
  seedDefaults(db);
  console.log("[DB] Reset complete");
}

// ─── Settings helpers ──────────────────────────────────────────────────────

function loadSettingsCache(): void {
  const db = getDb();
  const rows = db
    .prepare<
      [],
      { key: string; value: string }
    >("SELECT key, value FROM settings")
    .all();
  _settingsCache = new Map(rows.map((r) => [r.key, JSON.parse(r.value)]));
}

export function getSetting(key: string): unknown {
  if (!_settingsCache) loadSettingsCache();
  return _settingsCache!.get(key) ?? null;
}

export function setSetting(key: string, value: unknown): void {
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    key,
    JSON.stringify(value),
  );
  // Update in-memory cache so next getSetting() is instant
  if (_settingsCache) _settingsCache.set(key, value);
}

export function getAllSettings(): Record<string, unknown> {
  if (!_settingsCache) loadSettingsCache();
  return Object.fromEntries(_settingsCache!.entries());
}

// ─── App helpers ───────────────────────────────────────────────────────────

export interface RawApp {
  id: number;
  exe_name: string;
  exe_path: string | null;
  display_name: string;
  group_id: number | null;
  is_tracked: number;
  is_steam_import: number;
  icon_cache_path: string | null;
  custom_image_path: string | null;
  first_seen: number;
  last_seen: number;
}

export function upsertApp(
  exeName: string,
  exePath: string | null,
  displayName: string,
  now: number,
  isTracked: 0 | 1 = 1,
): number {
  const db = getDb();
  // Match on exe_name only — exe_path may arrive as null from process scanner
  // and non-null from active window. We must not create duplicate rows.
  const existing = db
    .prepare<[string], { id: number; exe_path: string | null }>(
      "SELECT id, exe_path FROM apps WHERE exe_name = ?",
    )
    .get(exeName);

  if (existing) {
    // If we now have the exe_path and the row doesn't, fill it in
    if (exePath && !existing.exe_path) {
      db.prepare("UPDATE apps SET exe_path = ?, last_seen = ? WHERE id = ?").run(
        exePath,
        now,
        existing.id,
      );
    } else {
      db.prepare("UPDATE apps SET last_seen = ? WHERE id = ?").run(
        now,
        existing.id,
      );
    }
    return existing.id;
  }

  const result = db
    .prepare(
      "INSERT INTO apps (exe_name, exe_path, display_name, is_tracked, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(exeName, exePath, displayName, isTracked, now, now);

  return result.lastInsertRowid as number;
}
