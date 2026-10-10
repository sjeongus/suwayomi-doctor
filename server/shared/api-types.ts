// Types shared by the server and the web UI. Type-only: no runtime code here.

export type Health = 'healthy' | 'warning' | 'broken' | 'unchecked' | 'ignored';
export type Severity = 'info' | 'warning' | 'broken';

export type CheckCode =
  | 'A1_SOURCE_MISSING'
  | 'A2_EXTENSION_OBSOLETE'
  | 'A3_EXTENSION_OUTDATED'
  | 'B1_NOT_FOUND'
  | 'B2_BLOCKED'
  | 'B3_REFRESH_ERROR'
  | 'B4_ZERO_CHAPTERS'
  | 'B5_CHAPTER_DROP'
  | 'C1_STALE'
  | 'C2_NEVER_REFRESHED';

export interface Finding {
  code: CheckCode;
  severity: Severity;
  /** One plain-English sentence for the card. */
  message: string;
  /** Optional suggestion shown under the message. */
  hint?: string;
}

/** How a refresh failed, from the error text Suwayomi returned. */
export type ErrorKind = 'not_found' | 'blocked' | 'source_missing' | 'no_chapters' | 'error';

export interface SeriesView {
  mangaId: number;
  title: string;
  status: string;
  sourceId: string;
  sourceName: string;
  sourceIconUrl: string | null;
  extensionName: string | null;
  categories: string[];
  realUrl: string | null;
  health: Health;
  /** Health ignoring the "ignored" flag, so muted series still show their state. */
  underlyingHealth: Exclude<Health, 'ignored'>;
  findings: Finding[];
  lastCheckedAt: number | null;
  firstUnhealthyAt: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  chapterCount: number | null;
  latestChapterAt: number | null;
  ignoredUntil: number | null;
  resolvedAt: number | null;
  suwayomiUrl: string;
  thumbnailUrl: string;
  /** Who scanlates it now according to MangaUpdates; null until looked up. */
  scanlators: ScanlatorHint | null;
}

export interface ScanlatorGroup {
  name: string;
  /** The group's page on MangaUpdates. */
  muUrl: string | null;
  /** The group's own website, when MangaUpdates lists one. */
  site: string | null;
  /** Its latest release, e.g. "Ch. 120". */
  chapter: string;
  /** YYYY-MM-DD. */
  releasedOn: string;
}

export interface ScanlatorHint {
  lookedUpAt: number;
  /** The MangaUpdates series, or null when none matched. */
  series: { title: string; url: string; matchedBy: string } | null;
  /** Groups behind the most recent releases, newest first. */
  groups: ScanlatorGroup[];
  error: string | null;
}

export interface SourceView {
  sourceId: string;
  name: string;
  iconUrl: string | null;
  extensionName: string | null;
  missing: boolean;
  obsolete: boolean;
  hasUpdate: boolean;
  outageStreak: number;
  seriesCount: number;
  brokenCount: number;
  warningCount: number;
}

export interface ScanRunView {
  id: number;
  trigger: 'cron' | 'manual' | 'single';
  state: 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt: number | null;
  total: number;
  checked: number;
  healthy: number;
  warning: number;
  broken: number;
  error: string | null;
}

export interface ScanProgress {
  running: boolean;
  run: ScanRunView | null;
  current: string[];
  waitingReason: string | null;
}

export interface Summary {
  counts: Record<Health, number>;
  resolved: number;
  lastScan: ScanRunView | null;
  nextScanAt: number | null;
  progress: ScanProgress;
  suwayomi: { url: string; publicUrl: string; reachable: boolean; version: string | null; error: string | null };
  migrateBrowseUrl: string;
}

export interface CheckHistoryEntry {
  scanId: number | null;
  at: number;
  ok: boolean;
  errorKind: ErrorKind | null;
  error: string | null;
  chapterCount: number | null;
  health: Health;
}

export interface Settings {
  scanCron: string;
  staleDays: number;
  sourceConcurrency: number;
  delayMs: number;
}

export type ServerEvent =
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'series'; mangaId: number }
  | { type: 'changed' };

export interface MihonSourceOption {
  sourceId: string;
  name: string;
  /** Library entries from this source in the backup. */
  count: number;
  /** Looks like the Suwayomi extension, going by its name. */
  isSuwayomi: boolean;
}

export interface MihonEntry {
  /** Title as Mihon has it. */
  title: string;
  /** Suwayomi's series id, read from the entry's URL; null when the URL has none. */
  mangaId: number | null;
  /** Title of the series with that id on the server, when there is one. */
  serverTitle: string | null;
  /** When the titles differ: why Doctor still thinks both are the same series. */
  matchedBy: string | null;
  /** When Doctor saw the series leave the library, if it did. */
  resolvedAt: number | null;
}

export interface MihonCheckResult {
  /** Every source with library entries in the backup, so the user can pick another one. */
  sources: MihonSourceOption[];
  /** The source that was checked, or null when none looks like Suwayomi. */
  sourceId: string | null;
  /** Library entries from that source. */
  checked: number;
  stillInLibrary: number;
  /** Still exists on the server, but no longer in the library. */
  removed: MihonEntry[];
  /** No series with that id exists on the server any more. */
  deleted: MihonEntry[];
  /** The id points at a series Doctor can't match to this entry, or the URL has no id. Not counted as orphans. */
  unsure: MihonEntry[];
  /** Most entries don't match, which suggests the backup is from a different Suwayomi server. */
  looksLikeOtherServer: boolean;
  /** The AniList lookup for titles that didn't match locally; null when there was nothing to look up. */
  anilist: { looked: number; matched: number; error: string | null } | null;
}
