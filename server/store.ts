import { all, get, run, type Db } from './db.js';
import type { ErrorKind, Finding, Health, ScanRunView, Settings } from './shared/api-types.js';
import type { RefreshState, SeriesSnapshot } from './health/rules.js';

export interface SeriesRow {
  manga_id: number;
  title: string;
  status: string;
  source_id: string;
  real_url: string | null;
  thumbnail_path: string | null;
  initialized: number;
  categories: string;
  chapter_count: number;
  latest_chapter_at: number | null;
  in_library: number;
  first_seen_at: number;
  last_synced_at: number;
  resolved_at: number | null;
  last_checked_at: number | null;
  last_ok: number | null;
  last_error_kind: ErrorKind | null;
  last_error: string | null;
  consecutive_failures: number;
  refresh_chapter_count: number | null;
  prev_chapter_count: number | null;
  ever_had_chapters: number;
  health: Health;
  underlying_health: Exclude<Health, 'ignored'>;
  findings: string;
  first_unhealthy_at: number | null;
  ignored_until: number | null;
}

export interface SourceRow {
  source_id: string;
  name: string;
  icon_url: string | null;
  extension_pkg: string | null;
  extension_name: string | null;
  missing: number;
  obsolete: number;
  has_update: number;
  outage_streak: number;
  last_synced_at: number;
}

export interface SyncedSeries {
  mangaId: number;
  title: string;
  status: string;
  sourceId: string;
  realUrl: string | null;
  thumbnailPath: string | null;
  initialized: boolean;
  categories: string[];
  chapterCount: number;
  latestChapterAt: number | null;
}

export interface SyncedSource {
  sourceId: string;
  name: string | null;
  iconUrl: string | null;
  extensionPkg: string | null;
  extensionName: string | null;
  missing: boolean;
  obsolete: boolean;
  hasUpdate: boolean;
}

// ---- series ---------------------------------------------------------------

export function upsertSeries(db: Db, s: SyncedSeries, now: number): void {
  run(
    db,
    `INSERT INTO series (manga_id, title, status, source_id, real_url, thumbnail_path, initialized, categories,
                         chapter_count, latest_chapter_at, in_library, first_seen_at, last_synced_at, resolved_at)
     VALUES (:id, :title, :status, :source, :realUrl, :thumb, :init, :cats, :count, :latest, 1, :now, :now, NULL)
     ON CONFLICT(manga_id) DO UPDATE SET
       title = excluded.title, status = excluded.status, source_id = excluded.source_id,
       real_url = excluded.real_url, thumbnail_path = excluded.thumbnail_path, initialized = excluded.initialized,
       categories = excluded.categories, chapter_count = excluded.chapter_count,
       latest_chapter_at = excluded.latest_chapter_at, in_library = 1, last_synced_at = excluded.last_synced_at,
       resolved_at = NULL`,
    {
      id: s.mangaId,
      title: s.title,
      status: s.status,
      source: s.sourceId,
      realUrl: s.realUrl,
      thumb: s.thumbnailPath,
      init: s.initialized ? 1 : 0,
      cats: JSON.stringify(s.categories),
      count: s.chapterCount,
      latest: s.latestChapterAt,
      now,
    },
  );
}

/** Series that left the library (e.g. after a migration) are marked resolved. */
export function resolveMissingSeries(db: Db, seenIds: number[], now: number): number {
  const seen = new Set(seenIds);
  const inLibrary = all<{ manga_id: number }>(db, 'SELECT manga_id FROM series WHERE in_library = 1');
  let resolved = 0;
  for (const { manga_id } of inLibrary) {
    if (seen.has(manga_id)) continue;
    run(db, 'UPDATE series SET in_library = 0, resolved_at = :now WHERE manga_id = :id', { id: manga_id, now });
    resolved++;
  }
  return resolved;
}

/** Marks one series as having left the library, e.g. after Doctor removed it. */
export function markRemoved(db: Db, mangaId: number, now: number): void {
  run(db, 'UPDATE series SET in_library = 0, resolved_at = :now WHERE manga_id = :id', { id: mangaId, now });
}

export function getSeries(db: Db, mangaId: number): SeriesRow | undefined {
  return get<SeriesRow>(db, 'SELECT * FROM series WHERE manga_id = :id', { id: mangaId });
}

export function listSeries(db: Db, opts: { inLibrary?: boolean } = {}): SeriesRow[] {
  if (opts.inLibrary === undefined) return all<SeriesRow>(db, 'SELECT * FROM series ORDER BY title COLLATE NOCASE');
  return all<SeriesRow>(db, 'SELECT * FROM series WHERE in_library = :lib ORDER BY title COLLATE NOCASE', {
    lib: opts.inLibrary ? 1 : 0,
  });
}

export function snapshotOf(row: SeriesRow, source: SourceRow | undefined): SeriesSnapshot {
  return {
    status: row.status,
    initialized: row.initialized === 1,
    sourceMissing: source?.missing === 1,
    extensionObsolete: source?.obsolete === 1,
    extensionHasUpdate: source?.has_update === 1,
    extensionName: source?.extension_name ?? null,
    chapterCount: row.chapter_count,
    latestChapterAt: row.latest_chapter_at,
  };
}

export function refreshStateOf(row: SeriesRow): RefreshState {
  return {
    lastCheckedAt: row.last_checked_at,
    lastOk: row.last_ok === null ? null : row.last_ok === 1,
    lastErrorKind: row.last_error_kind,
    lastError: row.last_error,
    consecutiveFailures: row.consecutive_failures,
    chapterCount: row.refresh_chapter_count,
    prevChapterCount: row.prev_chapter_count,
    everHadChapters: row.ever_had_chapters === 1,
  };
}

export function saveRefreshState(db: Db, mangaId: number, s: RefreshState): void {
  run(
    db,
    `UPDATE series SET last_checked_at = :at, last_ok = :ok, last_error_kind = :kind, last_error = :err,
       consecutive_failures = :fails, refresh_chapter_count = :count, prev_chapter_count = :prev,
       ever_had_chapters = :ever
     WHERE manga_id = :id`,
    {
      id: mangaId,
      at: s.lastCheckedAt,
      ok: s.lastOk === null ? null : s.lastOk ? 1 : 0,
      kind: s.lastErrorKind,
      err: s.lastError,
      fails: s.consecutiveFailures,
      count: s.chapterCount,
      prev: s.prevChapterCount,
      ever: s.everHadChapters ? 1 : 0,
    },
  );
}

export function saveEvaluation(
  db: Db,
  mangaId: number,
  e: { health: Health; underlying: Exclude<Health, 'ignored'>; findings: Finding[]; firstUnhealthyAt: number | null },
): void {
  run(
    db,
    `UPDATE series SET health = :health, underlying_health = :under, findings = :findings,
       first_unhealthy_at = :first WHERE manga_id = :id`,
    { id: mangaId, health: e.health, under: e.underlying, findings: JSON.stringify(e.findings), first: e.firstUnhealthyAt },
  );
}

export function setIgnoredUntil(db: Db, mangaId: number, until: number | null): void {
  run(db, 'UPDATE series SET ignored_until = :until WHERE manga_id = :id', { id: mangaId, until });
}

/** Overwrites the snapshot fields a refresh just told us about. */
export function updateSnapshotFromRefresh(
  db: Db,
  mangaId: number,
  r: { status: string; initialized: boolean; chapterCount?: number; latestChapterAt?: number | null },
): void {
  run(
    db,
    `UPDATE series SET status = :status, initialized = :init,
       chapter_count = COALESCE(:count, chapter_count),
       latest_chapter_at = CASE WHEN :hasLatest = 1 THEN :latest ELSE latest_chapter_at END
     WHERE manga_id = :id`,
    {
      id: mangaId,
      status: r.status,
      init: r.initialized ? 1 : 0,
      count: r.chapterCount ?? null,
      hasLatest: r.latestChapterAt === undefined ? 0 : 1,
      latest: r.latestChapterAt ?? null,
    },
  );
}

// ---- sources --------------------------------------------------------------

export function upsertSource(db: Db, s: SyncedSource, now: number): void {
  // A missing source has no name in Suwayomi any more, so keep the one we saw last time.
  run(
    db,
    `INSERT INTO sources (source_id, name, icon_url, extension_pkg, extension_name, missing, obsolete, has_update, last_synced_at)
     VALUES (:id, :name, :icon, :pkg, :ext, :missing, :obsolete, :upd, :now)
     ON CONFLICT(source_id) DO UPDATE SET
       name = CASE WHEN :hasName = 1 THEN excluded.name ELSE sources.name END,
       icon_url = COALESCE(excluded.icon_url, sources.icon_url),
       extension_pkg = COALESCE(excluded.extension_pkg, sources.extension_pkg),
       extension_name = COALESCE(excluded.extension_name, sources.extension_name),
       missing = excluded.missing, obsolete = excluded.obsolete, has_update = excluded.has_update,
       last_synced_at = excluded.last_synced_at`,
    {
      id: s.sourceId,
      name: s.name ?? (s.sourceId === '0' ? 'Local source' : `Missing source …${s.sourceId.slice(-4)}`),
      hasName: s.name ? 1 : 0,
      icon: s.iconUrl,
      pkg: s.extensionPkg,
      ext: s.extensionName,
      missing: s.missing ? 1 : 0,
      obsolete: s.obsolete ? 1 : 0,
      upd: s.hasUpdate ? 1 : 0,
      now,
    },
  );
}

export function listSources(db: Db): SourceRow[] {
  return all<SourceRow>(db, 'SELECT * FROM sources ORDER BY name COLLATE NOCASE');
}

export function sourceMap(db: Db): Map<string, SourceRow> {
  return new Map(listSources(db).map((s) => [s.source_id, s]));
}

export function setOutageStreak(db: Db, sourceId: string, streak: number): void {
  run(db, 'UPDATE sources SET outage_streak = :streak WHERE source_id = :id', { id: sourceId, streak });
}

// ---- scan runs and checks -------------------------------------------------

interface ScanRunRow {
  id: number;
  trigger: ScanRunView['trigger'];
  state: ScanRunView['state'];
  started_at: number;
  finished_at: number | null;
  total: number;
  checked: number;
  healthy: number;
  warning: number;
  broken: number;
  error: string | null;
}

function toRunView(r: ScanRunRow): ScanRunView {
  return {
    id: r.id,
    trigger: r.trigger,
    state: r.state,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    total: r.total,
    checked: r.checked,
    healthy: r.healthy,
    warning: r.warning,
    broken: r.broken,
    error: r.error,
  };
}

export function createScanRun(db: Db, trigger: ScanRunView['trigger'], now: number): number {
  return run(db, `INSERT INTO scan_runs (trigger, state, started_at) VALUES (:trigger, 'waiting', :now)`, { trigger, now })
    .lastInsertRowid;
}

export function updateScanRun(db: Db, id: number, patch: Partial<Omit<ScanRunView, 'id' | 'trigger' | 'startedAt'>>): void {
  const cols: Record<string, string> = {
    state: 'state',
    finishedAt: 'finished_at',
    total: 'total',
    checked: 'checked',
    healthy: 'healthy',
    warning: 'warning',
    broken: 'broken',
    error: 'error',
  };
  const sets: string[] = [];
  const params: Record<string, string | number | null> = { id };
  for (const [key, value] of Object.entries(patch)) {
    const col = cols[key];
    if (!col || value === undefined) continue;
    sets.push(`${col} = :${key}`);
    params[key] = value as string | number | null;
  }
  if (sets.length) run(db, `UPDATE scan_runs SET ${sets.join(', ')} WHERE id = :id`, params);
}

export function getScanRun(db: Db, id: number): ScanRunView | null {
  const r = get<ScanRunRow>(db, 'SELECT * FROM scan_runs WHERE id = :id', { id });
  return r ? toRunView(r) : null;
}

export function lastFinishedScan(db: Db): ScanRunView | null {
  const r = get<ScanRunRow>(
    db,
    `SELECT * FROM scan_runs WHERE trigger != 'single' AND state IN ('done', 'failed', 'cancelled') ORDER BY id DESC LIMIT 1`,
  );
  return r ? toRunView(r) : null;
}

/** Runs left "running" by a crash or restart are closed on startup. */
export function closeStaleRuns(db: Db, now: number): void {
  run(
    db,
    `UPDATE scan_runs SET state = 'cancelled', finished_at = :now, error = 'Doctor restarted during the scan'
     WHERE state IN ('waiting', 'running')`,
    { now },
  );
}

export function insertCheck(
  db: Db,
  c: { scanId: number | null; mangaId: number; at: number; ok: boolean; errorKind: ErrorKind | null; error: string | null; chapterCount: number | null; health: Health },
): void {
  run(
    db,
    `INSERT INTO checks (scan_id, manga_id, at, ok, error_kind, error, chapter_count, health)
     VALUES (:scan, :manga, :at, :ok, :kind, :err, :count, :health)`,
    {
      scan: c.scanId,
      manga: c.mangaId,
      at: c.at,
      ok: c.ok ? 1 : 0,
      kind: c.errorKind,
      err: c.error,
      count: c.chapterCount,
      health: c.health,
    },
  );
}

export function listChecks(db: Db, mangaId: number, limit = 30) {
  return all<{
    scan_id: number | null;
    at: number;
    ok: number;
    error_kind: ErrorKind | null;
    error: string | null;
    chapter_count: number | null;
    health: Health;
  }>(db, 'SELECT * FROM checks WHERE manga_id = :id ORDER BY at DESC, id DESC LIMIT :limit', { id: mangaId, limit });
}

// ---- settings -------------------------------------------------------------

export function loadSettings(db: Db, defaults: Settings): Settings {
  const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) as Partial<Settings>;
  return { ...defaults, ...stored };
}

export function saveSettings(db: Db, patch: Partial<Settings>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    run(db, 'INSERT INTO settings (key, value) VALUES (:key, :value) ON CONFLICT(key) DO UPDATE SET value = excluded.value', {
      key,
      value: JSON.stringify(value),
    });
  }
}
