import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

/** Ordered schema migrations. Append only; never edit a shipped entry. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE series (
    manga_id              INTEGER PRIMARY KEY,
    title                 TEXT    NOT NULL,
    status                TEXT    NOT NULL,
    source_id             TEXT    NOT NULL,
    real_url              TEXT,
    thumbnail_path        TEXT,
    initialized           INTEGER NOT NULL DEFAULT 0,
    categories            TEXT    NOT NULL DEFAULT '[]',
    chapter_count         INTEGER NOT NULL DEFAULT 0,
    latest_chapter_at     INTEGER,
    in_library            INTEGER NOT NULL DEFAULT 1,
    first_seen_at         INTEGER NOT NULL,
    last_synced_at        INTEGER NOT NULL,
    resolved_at           INTEGER,
    -- Doctor's own refresh history (see health/rules.ts RefreshState)
    last_checked_at       INTEGER,
    last_ok               INTEGER,
    last_error_kind       TEXT,
    last_error            TEXT,
    consecutive_failures  INTEGER NOT NULL DEFAULT 0,
    refresh_chapter_count INTEGER,
    prev_chapter_count    INTEGER,
    ever_had_chapters     INTEGER NOT NULL DEFAULT 0,
    -- Evaluated health
    health                TEXT    NOT NULL DEFAULT 'unchecked',
    underlying_health     TEXT    NOT NULL DEFAULT 'unchecked',
    findings              TEXT    NOT NULL DEFAULT '[]',
    first_unhealthy_at    INTEGER,
    ignored_until         INTEGER
  );
  CREATE INDEX series_source ON series(source_id);
  CREATE INDEX series_health ON series(health);

  CREATE TABLE sources (
    source_id       TEXT PRIMARY KEY,
    name            TEXT    NOT NULL,
    icon_url        TEXT,
    extension_pkg   TEXT,
    extension_name  TEXT,
    missing         INTEGER NOT NULL DEFAULT 0,
    obsolete        INTEGER NOT NULL DEFAULT 0,
    has_update      INTEGER NOT NULL DEFAULT 0,
    outage_streak   INTEGER NOT NULL DEFAULT 0,
    last_synced_at  INTEGER NOT NULL
  );

  CREATE TABLE scan_runs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger      TEXT    NOT NULL,
    state        TEXT    NOT NULL,
    started_at   INTEGER NOT NULL,
    finished_at  INTEGER,
    total        INTEGER NOT NULL DEFAULT 0,
    checked      INTEGER NOT NULL DEFAULT 0,
    healthy      INTEGER NOT NULL DEFAULT 0,
    warning      INTEGER NOT NULL DEFAULT 0,
    broken       INTEGER NOT NULL DEFAULT 0,
    error        TEXT
  );

  CREATE TABLE checks (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id        INTEGER REFERENCES scan_runs(id) ON DELETE SET NULL,
    manga_id       INTEGER NOT NULL REFERENCES series(manga_id) ON DELETE CASCADE,
    at             INTEGER NOT NULL,
    ok             INTEGER NOT NULL,
    error_kind     TEXT,
    error          TEXT,
    chapter_count  INTEGER,
    health         TEXT    NOT NULL
  );
  CREATE INDEX checks_manga ON checks(manga_id, at DESC);

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );
  `,
  `
  -- Who scanlates a series now, from MangaUpdates: a hint for where to migrate it.
  CREATE TABLE scanlator_hints (
    manga_id      INTEGER PRIMARY KEY REFERENCES series(manga_id) ON DELETE CASCADE,
    looked_up_at  INTEGER NOT NULL,
    mu_id         TEXT,
    mu_title      TEXT,
    mu_url        TEXT,
    matched_by    TEXT,
    groups        TEXT    NOT NULL DEFAULT '[]',
    error         TEXT
  );
  `,
];

export type Db = DatabaseSync;

export function openDb(dataDir: string): Db {
  let db: DatabaseSync;
  if (dataDir === ':memory:') {
    db = new DatabaseSync(':memory:');
  } else {
    mkdirSync(dataDir, { recursive: true });
    db = new DatabaseSync(join(dataDir, 'doctor.db'));
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export type Params = Record<string, SQLInputValue>;

export function all<T>(db: Db, sql: string, params: Params = {}): T[] {
  return db.prepare(sql).all(params) as T[];
}

export function get<T>(db: Db, sql: string, params: Params = {}): T | undefined {
  return db.prepare(sql).get(params) as T | undefined;
}

export function run(db: Db, sql: string, params: Params = {}): { changes: number; lastInsertRowid: number } {
  const r = db.prepare(sql).run(params);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

export const nowSec = (): number => Math.floor(Date.now() / 1000);
