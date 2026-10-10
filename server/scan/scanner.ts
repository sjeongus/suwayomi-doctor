import type { Config } from '../config.js';
import { nowSec, tx, type Db } from '../db.js';
import { bus } from '../events.js';
import { applyRefresh, isOutage, type RefreshOutcome } from '../health/rules.js';
import type { ScanProgress, ScanRunView, Settings } from '../shared/api-types.js';
import {
  closeStaleRuns,
  createScanRun,
  getScanRun,
  getSeries,
  insertCheck,
  listSeries,
  refreshStateOf,
  saveRefreshState,
  setOutageStreak,
  sourceMap,
  updateScanRun,
  updateSnapshotFromRefresh,
  type SeriesRow,
} from '../store.js';
import { SuwayomiUnreachableError, type SuwayomiClient } from '../suwayomi/client.js';
import {
  LIBRARY_UPDATE_RUNNING,
  latestChapterTime,
  REFRESH_MANGA,
  type LibraryUpdateRunning,
  type RefreshResult,
} from '../suwayomi/queries.js';
import { evaluateSeries } from './evaluate.js';
import { reevaluateAll, syncLibrary } from './sync.js';

const WAIT_POLL_MS = 30_000;
const MAX_WAIT_MS = 3 * 60 * 60 * 1000;

class Cancelled extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Cancelled());
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Cancelled());
    }, { once: true });
  });
}

export class Scanner {
  private runId: number | null = null;
  private abort: AbortController | null = null;
  private current = new Set<string>();
  private waitingReason: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly client: SuwayomiClient,
    private readonly config: Config,
    private readonly getSettings: () => Settings,
    /** Runs after a scan completes, e.g. to look up migration hints for newly broken series. */
    private readonly afterScan: () => void = () => {},
  ) {
    closeStaleRuns(db, nowSec());
  }

  get running(): boolean {
    return this.runId !== null;
  }

  progress(): ScanProgress {
    return {
      running: this.running,
      run: this.runId === null ? null : getScanRun(this.db, this.runId),
      current: [...this.current],
      waitingReason: this.waitingReason,
    };
  }

  private emitProgress(): void {
    bus.publish({ type: 'progress', progress: this.progress() });
  }

  /** Starts a full scan in the background. Returns the run id, or the running one. */
  start(trigger: 'cron' | 'manual'): number {
    if (this.runId !== null) return this.runId;
    const runId = createScanRun(this.db, trigger, nowSec());
    this.runId = runId;
    this.abort = new AbortController();
    void this.execute(runId, this.abort.signal).finally(() => {
      this.runId = null;
      this.abort = null;
      this.current.clear();
      this.waitingReason = null;
      this.emitProgress();
      bus.publish({ type: 'changed' });
    });
    this.emitProgress();
    return runId;
  }

  cancel(): boolean {
    if (!this.abort) return false;
    this.abort.abort();
    return true;
  }

  private async execute(runId: number, signal: AbortSignal): Promise<void> {
    const settings = this.getSettings();
    try {
      await syncLibrary(this.db, this.client, { includeLocalSource: this.config.includeLocalSource, settings, now: nowSec() });
      bus.publish({ type: 'changed' });
      await this.waitForLibraryUpdate(signal);

      const sources = sourceMap(this.db);
      const now = nowSec();
      const queue = listSeries(this.db, { inLibrary: true }).filter(
        (s) => !(s.ignored_until !== null && s.ignored_until > now) && sources.get(s.source_id)?.missing !== 1,
      );
      updateScanRun(this.db, runId, { state: 'running', total: queue.length, checked: 0 });
      this.emitProgress();

      const bySource = new Map<string, SeriesRow[]>();
      for (const s of queue) bySource.set(s.source_id, [...(bySource.get(s.source_id) ?? []), s]);

      const tally = new Map<string, { attempted: number; failed: number }>();
      let checked = 0;
      const sourceQueues = [...bySource.entries()];
      const worker = async () => {
        for (let next = sourceQueues.shift(); next; next = sourceQueues.shift()) {
          const [sourceId, series] = next;
          const t = { attempted: 0, failed: 0 };
          tally.set(sourceId, t);
          for (let i = 0; i < series.length; i++) {
            if (signal.aborted) throw new Cancelled();
            if (i > 0) await sleep(settings.delayMs, signal);
            const ok = await this.checkOne(series[i]!, runId, signal);
            t.attempted++;
            if (!ok) t.failed++;
            updateScanRun(this.db, runId, { checked: ++checked });
            this.emitProgress();
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(settings.sourceConcurrency, sourceQueues.length) }, worker));

      // Source-wide outage detection, then a final pass so outage rules apply to every series.
      const finishedAt = nowSec();
      tx(this.db, () => {
        for (const [sourceId, t] of tally) {
          const streak = sources.get(sourceId)?.outage_streak ?? 0;
          setOutageStreak(this.db, sourceId, isOutage(t.attempted, t.failed) ? streak + 1 : 0);
        }
      });
      reevaluateAll(this.db, settings, finishedAt);
      updateScanRun(this.db, runId, { state: 'done', finishedAt, ...this.counts() });
      this.afterScan();
    } catch (err) {
      const cancelled = err instanceof Cancelled || signal.aborted;
      updateScanRun(this.db, runId, {
        state: cancelled ? 'cancelled' : 'failed',
        finishedAt: nowSec(),
        error: cancelled ? null : (err as Error).message,
        ...this.counts(),
      });
      if (!cancelled) console.error(`[scan ${runId}] failed:`, err);
    }
  }

  private counts() {
    const rows = listSeries(this.db, { inLibrary: true });
    return {
      healthy: rows.filter((r) => r.health === 'healthy').length,
      warning: rows.filter((r) => r.health === 'warning').length,
      broken: rows.filter((r) => r.health === 'broken').length,
    };
  }

  private async waitForLibraryUpdate(signal: AbortSignal): Promise<void> {
    const started = Date.now();
    for (;;) {
      const status = await this.client.query<LibraryUpdateRunning>(LIBRARY_UPDATE_RUNNING);
      if (!status.libraryUpdateStatus.jobsInfo.isRunning) break;
      if (Date.now() - started > MAX_WAIT_MS) break;
      this.waitingReason = "Waiting for Suwayomi's own library update to finish";
      this.emitProgress();
      await sleep(WAIT_POLL_MS, signal);
    }
    this.waitingReason = null;
  }

  /** Refreshes one series in Suwayomi and records the result. Returns false when the refresh failed. */
  private async checkOne(series: SeriesRow, scanId: number | null, signal?: AbortSignal): Promise<boolean> {
    this.current.add(series.title);
    this.emitProgress();
    try {
      const outcome = await this.refresh(series.manga_id, signal);
      const now = nowSec();
      tx(this.db, () => {
        const row = getSeries(this.db, series.manga_id) ?? series;
        const state = applyRefresh(refreshStateOf(row), outcome.outcome, now);
        saveRefreshState(this.db, series.manga_id, state);
        if (outcome.manga) updateSnapshotFromRefresh(this.db, series.manga_id, outcome.manga);
        const updated = getSeries(this.db, series.manga_id)!;
        const health = evaluateSeries(this.db, updated, sourceMap(this.db).get(updated.source_id), this.getSettings(), now);
        insertCheck(this.db, {
          scanId,
          mangaId: series.manga_id,
          at: now,
          ok: state.lastOk === true,
          errorKind: state.lastOk ? null : state.lastErrorKind,
          error: state.lastOk ? null : state.lastError,
          chapterCount: state.lastOk ? state.chapterCount : null,
          health,
        });
        return state;
      });
      bus.publish({ type: 'series', mangaId: series.manga_id });
      const after = getSeries(this.db, series.manga_id)!;
      return after.last_ok === 1;
    } finally {
      this.current.delete(series.title);
    }
  }

  private async refresh(
    mangaId: number,
    signal?: AbortSignal,
  ): Promise<{ outcome: RefreshOutcome; manga?: { status: string; initialized: boolean; chapterCount?: number; latestChapterAt?: number | null } }> {
    const timeout = AbortSignal.timeout(this.config.refreshTimeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let result;
    try {
      result = await this.client.request<RefreshResult>(REFRESH_MANGA, { id: mangaId }, combined);
    } catch (err) {
      if (err instanceof SuwayomiUnreachableError) throw err;
      if (signal?.aborted) throw new Cancelled();
      if (timeout.aborted) return { outcome: { ok: false, message: `Timed out after ${Math.round(this.config.refreshTimeoutMs / 1000)}s` } };
      return { outcome: { ok: false, message: (err as Error).message } };
    }
    const data = result.data?.fetchMangaAndChapters ?? null;
    const manga = data
      ? {
          status: data.manga.status,
          initialized: data.manga.initialized,
          ...(result.errors.length === 0
            ? {
                chapterCount: data.chapters.length,
                latestChapterAt: data.chapters.reduce<number | null>((max, c) => {
                  const t = latestChapterTime(c.uploadDate, c.fetchedAt);
                  return t !== null && (max === null || t > max) ? t : max;
                }, null),
              }
            : {}),
        }
      : undefined;
    if (result.errors.length > 0) {
      return { outcome: { ok: false, message: result.errors[0]!.message }, manga };
    }
    if (!data) return { outcome: { ok: false, message: 'Suwayomi returned no data for the refresh' } };
    return { outcome: { ok: true, chapterCount: data.chapters.length }, manga };
  }

  /** Rechecks one series right away, outside the weekly scan. */
  async recheck(mangaId: number): Promise<void> {
    const series = getSeries(this.db, mangaId);
    if (!series) throw new Error(`Series ${mangaId} is not known to Doctor`);
    const source = sourceMap(this.db).get(series.source_id);
    if (source?.missing === 1) {
      // Nothing to refresh: re-sync so a reinstalled extension is noticed.
      await syncLibrary(this.db, this.client, { includeLocalSource: this.config.includeLocalSource, settings: this.getSettings(), now: nowSec() });
      bus.publish({ type: 'changed' });
      return;
    }
    await this.checkOne(series, null);
  }

  lastRun(): ScanRunView | null {
    return this.runId === null ? null : getScanRun(this.db, this.runId);
  }
}
