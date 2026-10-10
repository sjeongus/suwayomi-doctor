import { all, get, nowSec, run, type Db } from '../db.js';
import { bus } from '../events.js';
import type { ScanlatorGroup, ScanlatorHint } from '../shared/api-types.js';
import type { SuwayomiClient } from '../suwayomi/client.js';
import { MANGA_BY_IDS, type MangaByIds } from '../suwayomi/queries.js';
import { MangaUpdates, type MuGroupRelease, type MuSeries } from './client.js';

const MANGAUPDATES_TRACKER = 7;
/** Broken series get their hint refreshed after a scan when it's older than this. */
const STALE_SEC = 7 * 24 * 3600;

interface HintRow {
  manga_id: number;
  looked_up_at: number;
  mu_title: string | null;
  mu_url: string | null;
  matched_by: string | null;
  groups: string;
  error: string | null;
}

function toHint(r: HintRow): ScanlatorHint {
  return {
    lookedUpAt: r.looked_up_at,
    series: r.mu_title && r.mu_url ? { title: r.mu_title, url: r.mu_url, matchedBy: r.matched_by ?? '' } : null,
    groups: JSON.parse(r.groups) as ScanlatorGroup[],
    error: r.error,
  };
}

export function listHints(db: Db): Map<number, ScanlatorHint> {
  return new Map(all<HintRow>(db, 'SELECT * FROM scanlator_hints').map((r) => [r.manga_id, toHint(r)]));
}

export function getHint(db: Db, mangaId: number): ScanlatorHint | null {
  const r = get<HintRow>(db, 'SELECT * FROM scanlator_hints WHERE manga_id = :id', { id: mangaId });
  return r ? toHint(r) : null;
}

function saveHint(db: Db, mangaId: number, series: MuSeries | null, groups: MuGroupRelease[], error: string | null): void {
  run(
    db,
    `INSERT INTO scanlator_hints (manga_id, looked_up_at, mu_id, mu_title, mu_url, matched_by, groups, error)
     VALUES (:id, :at, :muId, :title, :url, :by, :groups, :error)
     ON CONFLICT(manga_id) DO UPDATE SET looked_up_at = :at, mu_id = :muId, mu_title = :title, mu_url = :url,
       matched_by = :by, groups = :groups, error = :error`,
    {
      id: mangaId,
      at: nowSec(),
      muId: series?.id ?? null,
      title: series?.title ?? null,
      url: series?.url ?? null,
      by: series?.matchedBy ?? null,
      groups: JSON.stringify(groups),
      error,
    },
  );
}

/** Finds who scanlates a series now on MangaUpdates, and stores it with the series. */
export class ScanlatorHints {
  private filling = false;

  constructor(
    private readonly db: Db,
    private readonly client: SuwayomiClient,
    private readonly mu = new MangaUpdates(),
  ) {}

  async lookup(mangaId: number, signal?: AbortSignal): Promise<ScanlatorHint> {
    const data = await this.client.query<MangaByIds>(MANGA_BY_IDS, { ids: [mangaId] }, AbortSignal.timeout(30_000));
    const manga = data.mangas.nodes[0];
    if (!manga) throw new Error('Suwayomi has no series with this id.');

    let series: MuSeries | null = null;
    let groups: MuGroupRelease[] = [];
    let error: string | null = null;
    try {
      // A MangaUpdates tracker link is certain; otherwise search by title.
      const tracked = manga.trackRecords.nodes.find((t) => t.trackerId === MANGAUPDATES_TRACKER && String(t.remoteId) !== '0');
      if (tracked) series = await this.mu.seriesById(String(tracked.remoteId), signal);
      series ??= await this.mu.findSeries(manga.title, signal);
      if (series) groups = await this.mu.latestGroups(series.id, signal);
    } catch (err) {
      error = `Couldn't reach MangaUpdates (${(err as Error).message}).`;
    }
    saveHint(this.db, mangaId, series, groups, error);
    return getHint(this.db, mangaId)!;
  }

  /** Looks up broken series with no recent hint, one at a time, in the background. */
  fillBroken(): void {
    if (this.filling) return;
    this.filling = true;
    void (async () => {
      try {
        const due = all<{ manga_id: number }>(
          this.db,
          `SELECT s.manga_id FROM series s LEFT JOIN scanlator_hints h ON h.manga_id = s.manga_id
           WHERE s.in_library = 1 AND s.health = 'broken' AND (h.manga_id IS NULL OR h.looked_up_at < :before OR h.error IS NOT NULL)`,
          { before: nowSec() - STALE_SEC },
        );
        for (const { manga_id } of due) {
          const hint = await this.lookup(manga_id).catch((err: Error) => {
            console.error(`[mangaupdates] series ${manga_id}: ${err.message}`);
            return null;
          });
          bus.publish({ type: 'changed' });
          if (hint?.error) break; // MangaUpdates is unreachable; try again after the next scan.
        }
      } finally {
        this.filling = false;
      }
    })();
  }
}
