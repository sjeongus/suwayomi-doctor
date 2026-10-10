import { describe, expect, it } from 'vitest';
import { classifyError, cleanErrorMessage } from './classify.js';
import { applyRefresh, EMPTY_REFRESH_STATE, evaluate, isOutage, type SeriesSnapshot } from './rules.js';

const NOW = 1_800_000_000;
const DAY = 86_400;

const snap = (over: Partial<SeriesSnapshot> = {}): SeriesSnapshot => ({
  status: 'ONGOING',
  initialized: true,
  sourceMissing: false,
  extensionObsolete: false,
  extensionHasUpdate: false,
  extensionName: 'MangaFoo',
  chapterCount: 50,
  latestChapterAt: NOW - 3 * DAY,
  ...over,
});

const run = (snapshot: SeriesSnapshot, refresh = EMPTY_REFRESH_STATE, sourceOutageStreak = 0) =>
  evaluate({ snapshot, refresh, sourceOutageStreak, staleDays: 90, now: NOW });

const codes = (r: ReturnType<typeof run>) => r.findings.map((f) => f.code);

const fail = (message: string, times: number) => {
  let s = EMPTY_REFRESH_STATE;
  for (let i = 0; i < times; i++) s = applyRefresh(s, { ok: false, message }, NOW);
  return s;
};

describe('classifyError', () => {
  it.each([
    ['HTTP error 404', 'not_found'],
    ['eu.kanade.tachiyomi.network.HttpException: HTTP error 410', 'not_found'],
    ['HTTP error 403', 'blocked'],
    ['HTTP error 503', 'blocked'],
    ['Failed to bypass Cloudflare', 'blocked'],
    ['Missing source 123456', 'source_missing'],
    ['No chapters found', 'no_chapters'],
    ['Source not installed: 99', 'source_missing'],
    ['HTTP error 500', 'error'],
    ['java.net.SocketTimeoutException: timeout', 'error'],
  ])('%s -> %s', (message, kind) => {
    expect(classifyError(message).kind).toBe(kind);
  });

  it('strips exception class names', () => {
    expect(cleanErrorMessage('java.lang.IllegalStateException: HTTP error 404\n\tat foo')).toBe('HTTP error 404');
    expect(cleanErrorMessage('Exception while fetching data (/fetchMangaAndChapters) : Missing source 5')).toBe('Missing source 5');
  });
});

describe('evaluate', () => {
  it('is unchecked before the first refresh and healthy after a good one', () => {
    expect(run(snap()).health).toBe('unchecked');
    const ok = applyRefresh(EMPTY_REFRESH_STATE, { ok: true, chapterCount: 50 }, NOW);
    expect(run(snap(), ok)).toEqual({ findings: [], health: 'healthy' });
  });

  it('flags a missing source as broken without waiting for a scan', () => {
    const r = run(snap({ sourceMissing: true }));
    expect(r.health).toBe('broken');
    expect(codes(r)).toEqual(['A1_SOURCE_MISSING']);
  });

  it('treats a "Missing source" refresh error as A1, not B3', () => {
    const r = run(snap(), fail('Missing source 42', 1));
    expect(codes(r)).toEqual(['A1_SOURCE_MISSING']);
  });

  it('flags obsolete extensions as broken and outdated ones as warnings', () => {
    expect(run(snap({ extensionObsolete: true })).health).toBe('broken');
    const r = run(snap({ extensionHasUpdate: true }));
    expect(r.health).toBe('warning');
    expect(codes(r)).toEqual(['A3_EXTENSION_OUTDATED']);
  });

  it('needs two 404s in a row before calling a series broken', () => {
    expect(run(snap(), fail('HTTP error 404', 1)).health).toBe('warning');
    expect(run(snap(), fail('HTTP error 404', 2)).health).toBe('broken');
  });

  it('needs three blocked scans in a row before calling a series broken', () => {
    expect(run(snap(), fail('HTTP error 403', 2)).health).toBe('warning');
    expect(run(snap(), fail('HTTP error 403', 3)).health).toBe('broken');
  });

  it('resets the failure streak after a good refresh', () => {
    const s = applyRefresh(fail('HTTP error 404', 3), { ok: true, chapterCount: 50 }, NOW);
    expect(s.consecutiveFailures).toBe(0);
    expect(run(snap(), s).health).toBe('healthy');
  });

  it('holds outage failures at warning until the outage repeats', () => {
    const s = fail('HTTP error 404', 2);
    expect(run(snap(), s, 1).health).toBe('warning');
    expect(run(snap(), s, 2).health).toBe('broken');
  });

  it('flags zero chapters: broken if there used to be some', () => {
    let s = applyRefresh(EMPTY_REFRESH_STATE, { ok: true, chapterCount: 10 }, NOW);
    s = applyRefresh(s, { ok: true, chapterCount: 0 }, NOW);
    expect(run(snap(), s).health).toBe('broken');
    const never = applyRefresh(EMPTY_REFRESH_STATE, { ok: true, chapterCount: 0 }, NOW);
    expect(run(snap({ chapterCount: 0, latestChapterAt: null }), never).health).toBe('warning');
  });

  it('treats "No chapters found" as an empty chapter list, not a failure', () => {
    const s = fail('No chapters found', 1);
    expect(s.lastOk).toBe(true);
    expect(codes(run(snap({ chapterCount: 3 }), s))).toEqual(['B4_ZERO_CHAPTERS']);
    expect(run(snap({ chapterCount: 3 }), s).health).toBe('broken');
    expect(run(snap({ chapterCount: 0, latestChapterAt: null }), s).health).toBe('warning');
  });

  it('warns when the chapter count halves', () => {
    let s = applyRefresh(EMPTY_REFRESH_STATE, { ok: true, chapterCount: 100 }, NOW);
    s = applyRefresh(s, { ok: true, chapterCount: 40 }, NOW);
    expect(codes(run(snap(), s))).toEqual(['B5_CHAPTER_DROP']);
  });

  it('flags ongoing series with no chapter for longer than staleDays', () => {
    const old = snap({ latestChapterAt: NOW - 120 * DAY });
    expect(codes(run(old))).toEqual(['C1_STALE']);
    expect(codes(run({ ...old, status: 'COMPLETED' }))).toEqual([]);
    expect(codes(run({ ...old, status: 'ON_HIATUS' }))).toEqual([]);
  });

  it('orders findings worst first', () => {
    const r = run(snap({ extensionHasUpdate: true, extensionObsolete: true }));
    expect(r.findings[0]?.severity).toBe('broken');
  });
});

describe('isOutage', () => {
  it('requires enough series and a high failure ratio', () => {
    expect(isOutage(2, 2)).toBe(false);
    expect(isOutage(5, 3)).toBe(true);
    expect(isOutage(10, 5)).toBe(false);
  });
});
