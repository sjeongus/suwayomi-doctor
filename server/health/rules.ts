import type { ErrorKind, Finding, Health, Severity } from '../shared/api-types.js';
import { classifyError, cleanErrorMessage } from './classify.js';

/** What the last library sync knows about a series and its source. */
export interface SeriesSnapshot {
  status: string;
  initialized: boolean;
  sourceMissing: boolean;
  extensionObsolete: boolean;
  extensionHasUpdate: boolean;
  extensionName: string | null;
  chapterCount: number;
  /** Epoch seconds of the newest chapter, or null when unknown. */
  latestChapterAt: number | null;
}

/** What Doctor remembers about its own refreshes of a series. */
export interface RefreshState {
  lastCheckedAt: number | null;
  lastOk: boolean | null;
  lastErrorKind: ErrorKind | null;
  lastError: string | null;
  consecutiveFailures: number;
  chapterCount: number | null;
  prevChapterCount: number | null;
  everHadChapters: boolean;
}

export type RefreshOutcome =
  | { ok: true; chapterCount: number }
  | { ok: false; message: string };

export interface EvaluateInput {
  snapshot: SeriesSnapshot;
  refresh: RefreshState;
  /** Consecutive scans in which most series on this source failed (0 = no outage). */
  sourceOutageStreak: number;
  staleDays: number;
  now: number;
}

export const EMPTY_REFRESH_STATE: RefreshState = {
  lastCheckedAt: null,
  lastOk: null,
  lastErrorKind: null,
  lastError: null,
  consecutiveFailures: 0,
  chapterCount: null,
  prevChapterCount: null,
  everHadChapters: false,
};

/** Failures needed in a row before each kind counts as broken. */
export const BROKEN_AFTER: Record<Exclude<ErrorKind, 'source_missing' | 'no_chapters'>, number> = {
  not_found: 2,
  blocked: 3,
  error: 2,
};

/** Share of a source's series that must fail in one scan to call it a source-wide outage. */
export const OUTAGE_RATIO = 0.6;
export const OUTAGE_MIN_SERIES = 3;
/** Outage scans in a row before outage-affected series may turn broken. */
export const OUTAGE_BROKEN_AFTER = 2;

const STALE_STATUSES = new Set(['ONGOING', 'UNKNOWN']);
const DAY = 86_400;

export function applyRefresh(state: RefreshState, outcome: RefreshOutcome, now: number): RefreshState {
  if (outcome.ok) {
    return {
      lastCheckedAt: now,
      lastOk: true,
      lastErrorKind: null,
      lastError: null,
      consecutiveFailures: 0,
      chapterCount: outcome.chapterCount,
      prevChapterCount: state.chapterCount,
      everHadChapters: state.everHadChapters || outcome.chapterCount > 0,
    };
  }
  const { kind } = classifyError(outcome.message);
  // Suwayomi throws "No chapters found" for an empty chapter list: the source answered, it just listed nothing.
  if (kind === 'no_chapters') return applyRefresh(state, { ok: true, chapterCount: 0 }, now);
  return {
    ...state,
    lastCheckedAt: now,
    lastOk: false,
    lastErrorKind: kind,
    lastError: cleanErrorMessage(outcome.message),
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function scansPhrase(n: number): string {
  return n === 1 ? 'on the last scan' : `on the last ${n} scans in a row`;
}

export function evaluate(input: EvaluateInput): { findings: Finding[]; health: Exclude<Health, 'ignored'> } {
  const { snapshot, refresh, sourceOutageStreak, staleDays, now } = input;
  const findings: Finding[] = [];
  const ext = snapshot.extensionName ? `The ${snapshot.extensionName} extension` : 'The extension';

  // A. Source checks
  const sourceMissing = snapshot.sourceMissing || (refresh.lastOk === false && refresh.lastErrorKind === 'source_missing');
  if (sourceMissing) {
    findings.push({
      code: 'A1_SOURCE_MISSING',
      severity: 'broken',
      message: 'Suwayomi can no longer load this source.',
      hint: 'The extension was uninstalled or no longer includes this source. Reinstall it or migrate.',
    });
  }
  if (snapshot.extensionObsolete) {
    findings.push({
      code: 'A2_EXTENSION_OBSOLETE',
      severity: 'broken',
      message: `${ext} was removed from your extension repo, so it is no longer supported.`,
      hint: 'It may keep working for a while, but it will not get fixes.',
    });
  }
  if (snapshot.extensionHasUpdate && !sourceMissing) {
    findings.push({
      code: 'A3_EXTENSION_OUTDATED',
      severity: 'warning',
      message: `${ext} has an update available.`,
      hint: 'Update it in Suwayomi first; updates often fix broken sources.',
    });
  }

  // B. Live refresh checks
  if (
    refresh.lastOk === false &&
    refresh.lastErrorKind &&
    refresh.lastErrorKind !== 'source_missing' &&
    refresh.lastErrorKind !== 'no_chapters'
  ) {
    const n = refresh.consecutiveFailures;
    const kind = refresh.lastErrorKind;
    let severity: Severity = n >= BROKEN_AFTER[kind] ? 'broken' : 'warning';
    let hint: string | undefined;

    const outage = sourceOutageStreak > 0;
    if (outage && sourceOutageStreak < OUTAGE_BROKEN_AFTER) {
      severity = 'warning';
      hint = 'Most series on this source failed in the same scan, so the site may just be down.';
    } else if (outage) {
      hint = `Most series on this source have failed for ${plural(sourceOutageStreak, 'scan')} in a row.`;
    }

    if (kind === 'not_found') {
      findings.push({
        code: 'B1_NOT_FOUND',
        severity,
        message: `The source returned "not found" ${scansPhrase(n)}.`,
        hint: hint ?? (severity === 'broken'
          ? 'The series was probably removed or moved on this site.'
          : 'It will be marked broken if this happens again next scan.'),
      });
    } else if (kind === 'blocked') {
      findings.push({
        code: 'B2_BLOCKED',
        severity,
        message: `The source blocked Suwayomi's request ${scansPhrase(n)}.`,
        hint: hint ?? 'Usually Cloudflare or rate limiting. Check FlareSolverr/Byparr in Suwayomi before migrating.',
      });
    } else {
      findings.push({
        code: 'B3_REFRESH_ERROR',
        severity,
        message: `Refreshing failed ${scansPhrase(n)}: ${refresh.lastError ?? 'unknown error'}`,
        hint: hint ?? (severity === 'broken'
          ? 'The site layout may have changed. Check for an extension update or migrate.'
          : 'It will be marked broken if this happens again next scan.'),
      });
    }
  }

  if (refresh.lastOk === true && refresh.chapterCount === 0) {
    // Suwayomi keeps the old chapters when a refresh comes back empty, so the snapshot count still shows them.
    const hadChapters = refresh.everHadChapters || snapshot.chapterCount > 0;
    findings.push({
      code: 'B4_ZERO_CHAPTERS',
      severity: hadChapters ? 'broken' : 'warning',
      message: hadChapters
        ? 'The last refresh found no chapters, though there used to be some.'
        : 'This source lists no chapters for the series.',
    });
  }

  if (
    refresh.lastOk === true &&
    refresh.chapterCount !== null &&
    refresh.chapterCount > 0 &&
    refresh.prevChapterCount !== null &&
    refresh.prevChapterCount >= 4 &&
    refresh.chapterCount <= refresh.prevChapterCount * 0.5
  ) {
    findings.push({
      code: 'B5_CHAPTER_DROP',
      severity: 'warning',
      message: `The chapter count dropped from ${refresh.prevChapterCount} to ${refresh.chapterCount}.`,
      hint: 'The source may have pulled chapters or restructured the series.',
    });
  }

  // C. Staleness
  const chapterCount = refresh.lastOk === true && refresh.chapterCount !== null ? refresh.chapterCount : snapshot.chapterCount;
  if (
    !sourceMissing &&
    STALE_STATUSES.has(snapshot.status) &&
    chapterCount > 0 &&
    snapshot.latestChapterAt !== null &&
    now - snapshot.latestChapterAt > staleDays * DAY
  ) {
    const days = Math.floor((now - snapshot.latestChapterAt) / DAY);
    findings.push({
      code: 'C1_STALE',
      severity: 'warning',
      message: `No new chapters in ${days} days.`,
      hint: 'The series is listed as ongoing. Another source may be further ahead.',
    });
  }

  if (!snapshot.initialized && !sourceMissing && refresh.lastOk !== true) {
    findings.push({
      code: 'C2_NEVER_REFRESHED',
      severity: 'info',
      message: "Suwayomi has never loaded this series' details.",
    });
  }

  return { findings: sortFindings(findings), health: healthOf(findings, refresh) };
}

const SEVERITY_RANK: Record<Severity, number> = { broken: 2, warning: 1, info: 0 };

function sortFindings(findings: Finding[]): Finding[] {
  return findings.toSorted((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function healthOf(findings: Finding[], refresh: RefreshState): Exclude<Health, 'ignored'> {
  const worst = findings.reduce((max, f) => Math.max(max, SEVERITY_RANK[f.severity]), -1);
  if (worst === 2) return 'broken';
  if (worst === 1) return 'warning';
  return refresh.lastCheckedAt === null ? 'unchecked' : 'healthy';
}

/** Decides whether this scan saw a source-wide outage. */
export function isOutage(attempted: number, failed: number): boolean {
  return attempted >= OUTAGE_MIN_SERIES && failed / attempted >= OUTAGE_RATIO;
}
