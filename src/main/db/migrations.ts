import { v4 as uuidv4 } from 'uuid'
import type { DbCompat } from './client'

type Migration = {
  version: number
  up: (db: DbCompat) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS app_groups (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          name              TEXT NOT NULL UNIQUE,
          description       TEXT NOT NULL DEFAULT '',
          icon_cache_path   TEXT,
          custom_image_path TEXT,
          tags              TEXT NOT NULL DEFAULT '[]',
          is_manual         INTEGER NOT NULL DEFAULT 0,
          created_at        INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS apps (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          exe_name          TEXT NOT NULL,
          exe_path          TEXT,
          display_name      TEXT NOT NULL,
          group_id          INTEGER REFERENCES app_groups(id) ON DELETE SET NULL,
          is_tracked        INTEGER NOT NULL DEFAULT 1,
          icon_cache_path   TEXT,
          custom_image_path TEXT,
          description       TEXT NOT NULL DEFAULT '',
          notes             TEXT NOT NULL DEFAULT '',
          tags              TEXT NOT NULL DEFAULT '[]',
          first_seen        INTEGER NOT NULL,
          last_seen         INTEGER NOT NULL,
          UNIQUE(exe_name, exe_path)
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id       INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
          session_type TEXT NOT NULL CHECK(session_type IN ('active','running')),
          started_at   INTEGER NOT NULL,
          ended_at     INTEGER,
          window_title TEXT,
          machine_id   TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_app_id     ON sessions(app_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_type       ON sessions(session_type);

        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_rules (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          group_id   INTEGER NOT NULL REFERENCES app_groups(id) ON DELETE CASCADE,
          pattern    TEXT NOT NULL,
          match_type TEXT NOT NULL CHECK(match_type IN ('regex','exact','prefix')),
          is_manual  INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY
        );
      `)
    }
  }
]

export function runMigrations(db: DbCompat): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    );
  `)

  const current = db
    .prepare<[], { version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    )
    .get()

  const currentVersion = (current?.version as number) ?? 0
  const pending = migrations.filter((m) => m.version > currentVersion)

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db)
      db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)').run(migration.version)
    })()
    console.log(`[DB] Ran migration v${migration.version}`)
  }
}

export function seedDefaults(db: DbCompat): void {
  const defaults: Array<[string, string]> = [
    ['poll_interval_ms', '5000'],
    ['tracking_mode', '"blacklist"'],
    ['machine_id', JSON.stringify(uuidv4())],
    ['record_titles', 'true'],
    ['theme', '"system"'],
    ['dashboard_default_range', '"today"']
  ]

  db.transaction(() => {
    for (const [key, value] of defaults) {
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value)
    }
  })()
}
