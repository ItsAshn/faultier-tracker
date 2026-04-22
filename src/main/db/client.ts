import Database from "better-sqlite3";
import { app } from "electron";
import path from "path";
import fs from "fs";
import { runMigrations, seedDefaults } from "./migrations";

// ─── Compatibility interface (matches better-sqlite3 API natively) ──────────

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
  /** No-op with better-sqlite3 — prepared statements never go stale. */
  clearStmtCache(): void;
}

// ─── Singleton state ────────────────────────────────────────────────────────

let _db: DbCompat | null = null;
let _dbPath = "";
let _dbWasCorrupted = false;

// In-memory settings cache — populated on first getSetting() call, invalidated on set
let _settingsCache: Map<string, unknown> | null = null;

export function getDb(): DbCompat {
  if (!_db) throw new Error("Database not initialized. Call openDb() first.");
  return _db;
}

export function isDbOpen(): boolean {
  return _db !== null;
}

export function wasDbCorrupted(): boolean {
  return _dbWasCorrupted;
}

function openRaw(dbPath: string): Database.Database {
  return new Database(dbPath);
}

function attachCompat(raw: Database.Database): DbCompat & { close(): void } {
  return {
    prepare(sql: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return raw.prepare(sql) as any;
    },
    exec(sql: string): void {
      raw.exec(sql);
    },
    // better-sqlite3 transaction() returns a callable directly — wrap to
    // match DbCompat which expects a factory returning () => T.
    transaction<T>(fn: () => T): () => T {
      return raw.transaction(fn) as unknown as () => T;
    },
    pragma(str: string): void {
      raw.pragma(str);
    },
    close(): void {
      raw.close();
    },
    clearStmtCache(): void {
      // No-op: better-sqlite3 prepared statements never go stale.
    },
  };
}

export function openDb(): DbCompat {
  if (_db) return _db;

  const userDataPath = app.getPath("userData");
  fs.mkdirSync(userDataPath, { recursive: true });
  _dbPath = path.join(userDataPath, "data.db");

  let raw: Database.Database;
  try {
    raw = openRaw(_dbPath);
  } catch (err) {
    console.error("[DB] Corrupted database file detected, backing up and creating fresh:", err);
    const backupPath = `${_dbPath}.corrupted.${Date.now()}`;
    try { fs.renameSync(_dbPath, backupPath); } catch { /* ignore */ }
    raw = openRaw(_dbPath);
    _dbWasCorrupted = true;
  }

  // WAL mode: concurrent reads don't block writes; writes don't block reads.
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  _db = attachCompat(raw);

  runMigrations(_db);
  seedDefaults(_db);

  return _db;
}

/** With better-sqlite3 every write goes directly to disk — this is a no-op
 *  kept for call-sites that existed under the sql.js implementation. */
export function persistDb(): void {
  // No-op: better-sqlite3 writes synchronously to the file on every statement.
}

export function closeDb(): void {
  _settingsCache = null;
  const db = _db;
  _db = null;
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
}

export function resetDbData(): void {
  const db = getDb();
  db.exec(`
    DELETE FROM sessions;
    DELETE FROM apps;
    DELETE FROM app_groups;
    DELETE FROM settings;
  `);
  _settingsCache = null;
  seedDefaults(db);
}
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
  linked_steam_app_id: number | null;
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
