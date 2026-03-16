import { v4 as uuidv4 } from "uuid";
import type { DbCompat } from "./client";

type Migration = {
  version: number;
  up: (db: DbCompat) => void;
};

const migrations: Migration[] = [
  {
    // Add linked_steam_app_id column to support explicit exe→steam app links.
    // When a raw exe row is confirmed to be a duplicate of a steam:APPID row
    // the merge logic reassigns sessions and deletes the exe row; this column
    // is used transiently while the merge is pending (e.g. user has been
    // prompted but not yet confirmed).  A NULL value means no link is set.
    version: 9,
    up(db) {
      db.exec(`
        ALTER TABLE apps ADD COLUMN linked_steam_app_id INTEGER REFERENCES apps(id) ON DELETE SET NULL;
      `);
      console.log('[DB] Migration v9: Added linked_steam_app_id column');
    },
  },
  {
    // Add Steam import tracking columns and delta session support
    version: 8,
    up(db) {
      db.exec(`
        -- Add columns to track Steam imports and cached playtime
        ALTER TABLE apps ADD COLUMN is_steam_import INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE apps ADD COLUMN last_steam_playtime_ms INTEGER DEFAULT 0;
        
        -- Mark existing Steam apps
        UPDATE apps SET is_steam_import = 1 WHERE exe_name LIKE 'steam:%';
        
        -- Initialize last_steam_playtime_ms for existing imports
        UPDATE apps 
        SET last_steam_playtime_ms = (
          SELECT COALESCE(SUM(ended_at - started_at), 0)
          FROM sessions 
          WHERE sessions.app_id = apps.id 
          AND machine_id = 'steam-import'
        )
        WHERE is_steam_import = 1;
      `);
      console.log('[DB] Migration v8: Added Steam tracking columns');
    },
  },
  {
    // Clean up database for simplified v2.0 architecture:
    // - Remove clutter columns (description, notes, tags, goals)
    // - Remove window_title tracking (stop collecting)
    // - Drop group_rules table (simplify grouping)
    // - Clean old data
    version: 7,
    up(db) {
      db.exec(`
        -- Clean up old data
        UPDATE sessions SET window_title = NULL;
        UPDATE apps SET description = '', notes = '', tags = '[]', daily_goal_ms = NULL;
        UPDATE app_groups SET description = '', category = NULL, daily_goal_ms = NULL;
        DELETE FROM group_rules;

        -- Drop group_rules table
        DROP TABLE IF EXISTS group_rules;

        -- Recreate apps table without clutter columns
        CREATE TABLE apps_new (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          exe_name          TEXT NOT NULL UNIQUE,
          exe_path          TEXT,
          display_name      TEXT NOT NULL,
          group_id          INTEGER REFERENCES app_groups(id) ON DELETE SET NULL,
          is_tracked        INTEGER NOT NULL DEFAULT 1,
          icon_cache_path   TEXT,
          custom_image_path TEXT,
          first_seen        INTEGER NOT NULL,
          last_seen         INTEGER NOT NULL
        );

        INSERT INTO apps_new (id, exe_name, exe_path, display_name, group_id, is_tracked, icon_cache_path, custom_image_path, first_seen, last_seen)
        SELECT id, exe_name, exe_path, display_name, group_id, is_tracked, icon_cache_path, custom_image_path, first_seen, last_seen FROM apps;

        DROP TABLE apps;
        ALTER TABLE apps_new RENAME TO apps;

        -- Recreate app_groups table without clutter columns
        CREATE TABLE app_groups_new (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          name              TEXT NOT NULL UNIQUE,
          icon_cache_path   TEXT,
          custom_image_path TEXT,
          is_manual         INTEGER NOT NULL DEFAULT 0,
          created_at        INTEGER NOT NULL
        );

        INSERT INTO app_groups_new (id, name, icon_cache_path, custom_image_path, is_manual, created_at)
        SELECT id, name, icon_cache_path, custom_image_path, is_manual, created_at FROM app_groups;

        DROP TABLE app_groups;
        ALTER TABLE app_groups_new RENAME TO app_groups;

        -- Recreate sessions table without window_title
        CREATE TABLE sessions_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          app_id       INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
          session_type TEXT NOT NULL CHECK(session_type IN ('active')),
          started_at   INTEGER NOT NULL,
          ended_at     INTEGER,
          machine_id   TEXT NOT NULL
        );

        INSERT INTO sessions_new (id, app_id, session_type, started_at, ended_at, machine_id)
        SELECT id, app_id, 'active', started_at, ended_at, machine_id FROM sessions;

        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;

        -- Recreate indexes
        CREATE INDEX IF NOT EXISTS idx_apps_exe_name        ON apps(exe_name);
        CREATE INDEX IF NOT EXISTS idx_sessions_time_range  ON sessions(started_at, ended_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_app_id      ON sessions(app_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at  ON sessions(started_at);
      `);
    },
  },
  {
    // Steam-imported sessions were incorrectly stored as session_type='running'.
    // Steam's playtime_forever is actual play time, not background-running time,
    // so it should be 'active'. This also fixes the display bug where playing a
    // Steam-imported game causes the card to flip from showing 47h (running_ms)
    // to <1m (active_ms), because active_ms > 0 triggers the fallback to stop.
    version: 6,
    up(db) {
      db.exec(`
        UPDATE sessions SET session_type = 'active'
        WHERE machine_id = 'steam-import' AND session_type = 'running';
      `);
    },
  },
  {
    // Merge duplicate apps rows that share the same exe_name but differ only in
    // exe_path (NULL vs real path), then rebuild the apps table with a
    // UNIQUE(exe_name) constraint instead of UNIQUE(exe_name, exe_path) so that
    // the process-scanner (null path) and active-window (real path) always
    // resolve to the same app_id.
    version: 5,
    up(db) {
      db.exec(`
        -- 1. For every group of duplicate exe_names, pick the canonical row:
        --    prefer the one with a non-null exe_path; on ties take the lowest id.
        CREATE TEMP TABLE _canon AS
          SELECT
            exe_name,
            MIN(CASE WHEN exe_path IS NOT NULL THEN id ELSE NULL END) AS best_with_path,
            MIN(id) AS best_any
          FROM apps
          GROUP BY exe_name
          HAVING COUNT(*) > 1;

        -- 2. Re-point sessions from duplicate rows to the canonical row.
        UPDATE sessions
          SET app_id = COALESCE(
            (SELECT best_with_path FROM _canon WHERE _canon.exe_name =
              (SELECT exe_name FROM apps WHERE apps.id = sessions.app_id)),
            (SELECT best_any FROM _canon WHERE _canon.exe_name =
              (SELECT exe_name FROM apps WHERE apps.id = sessions.app_id))
          )
          WHERE app_id IN (
            SELECT id FROM apps WHERE exe_name IN (SELECT exe_name FROM _canon)
          )
          AND app_id NOT IN (
            SELECT COALESCE(best_with_path, best_any) FROM _canon
          );

        -- 3. Delete the non-canonical duplicate rows.
        DELETE FROM apps
          WHERE exe_name IN (SELECT exe_name FROM _canon)
          AND id NOT IN (SELECT COALESCE(best_with_path, best_any) FROM _canon);

        -- 4. Fill in exe_path on the canonical row from any deleted sibling
        --    (already removed above, so just ensure canonical row has its path).
        --    (Nothing to do — canonical row was the one with path, if any existed.)

        DROP TABLE _canon;

        -- 5. Rebuild the apps table with UNIQUE(exe_name) replacing UNIQUE(exe_name, exe_path).
        CREATE TABLE apps_new (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          exe_name          TEXT NOT NULL UNIQUE,
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
          daily_goal_ms     INTEGER
        );

        INSERT INTO apps_new SELECT * FROM apps;

        DROP TABLE apps;
        ALTER TABLE apps_new RENAME TO apps;

        -- Re-create indexes that were on the old table.
        CREATE INDEX IF NOT EXISTS idx_apps_exe_name        ON apps(exe_name);
        CREATE INDEX IF NOT EXISTS idx_sessions_time_range  ON sessions(started_at, ended_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_app_id      ON sessions(app_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_started_at  ON sessions(started_at);
        CREATE INDEX IF NOT EXISTS idx_sessions_type        ON sessions(session_type);
      `);
    },
  },
  {
    version: 4,
    up(db) {
      // Covering index for the session range query used by SESSIONS_GET_RANGE every 30s
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_sessions_time_range ON sessions(started_at, ended_at);
      `);
    },
  },
  {
    version: 3,
    up(db) {
      // Add index on apps(exe_name) — queried on every tracking tick for every running process
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_apps_exe_name ON apps(exe_name);
      `);
    },
  },
  {
    version: 2,
    up(db) {
      // Add daily goal and category fields
      db.exec(`
        ALTER TABLE apps ADD COLUMN daily_goal_ms INTEGER;
        ALTER TABLE app_groups ADD COLUMN daily_goal_ms INTEGER;
        ALTER TABLE app_groups ADD COLUMN category TEXT;
      `);
    },
  },
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
      `);
    },
  },
];

export function runMigrations(db: DbCompat): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY
    );
  `);

  const current = db
    .prepare<
      [],
      { version: number }
    >("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
    .get();

  const currentVersion = (current?.version as number) ?? 0;
  const pending = migrations
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)",
      ).run(migration.version);
    })();
    console.log(`[DB] Ran migration v${migration.version}`);
  }
}

export function seedDefaults(db: DbCompat): void {
  const defaults: Array<[string, string]> = [
    ["poll_interval_ms", "5000"],
    ["machine_id", JSON.stringify(uuidv4())],
    ["theme", '"system"'],
    ["idle_threshold_ms", "300000"],
    ["steam_prompt_dismissed", "false"],
    ["launch_at_startup", "false"],
    ["first_run_completed", "false"],
  ];

  db.transaction(() => {
    for (const [key, value] of defaults) {
      db.prepare(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
      ).run(key, value);
    }
  })();
}
