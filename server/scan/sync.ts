import type { Db } from '../db.js';
import { tx } from '../db.js';
import type { SuwayomiClient } from '../suwayomi/client.js';
import { LIBRARY_PAGE, latestChapterTime, type LibraryManga, type LibraryPage } from '../suwayomi/queries.js';
import type { Settings } from '../shared/api-types.js';
import { listSeries, resolveMissingSeries, sourceMap, upsertSeries, upsertSource, type SyncedSource } from '../store.js';
import { evaluateSeries } from './evaluate.js';

export const LOCAL_SOURCE_ID = '0';

export async function fetchLibrary(client: SuwayomiClient, pageSize = 100): Promise<LibraryManga[]> {
  const out: LibraryManga[] = [];
  let after: string | null = null;
  for (;;) {
    const page: LibraryPage = await client.query<LibraryPage>(LIBRARY_PAGE, { first: pageSize, after });
    out.push(...page.mangas.nodes);
    if (!page.mangas.pageInfo.hasNextPage || !page.mangas.pageInfo.endCursor) return out;
    after = page.mangas.pageInfo.endCursor;
  }
}

export interface SyncResult {
  series: number;
  resolved: number;
}

/** Mirrors Suwayomi's library into Doctor's DB and re-runs the checks that need no site traffic. */
export async function syncLibrary(
  db: Db,
  client: SuwayomiClient,
  opts: { includeLocalSource: boolean; settings: Settings; now: number },
): Promise<SyncResult> {
  const library = (await fetchLibrary(client)).filter((m) => opts.includeLocalSource || m.sourceId !== LOCAL_SOURCE_ID);
  const { now } = opts;

  const sources = new Map<string, SyncedSource>();
  for (const m of library) {
    if (sources.has(m.sourceId)) continue;
    const ext = m.source?.extension ?? null;
    sources.set(m.sourceId, {
      sourceId: m.sourceId,
      name: m.source?.displayName ?? null,
      iconUrl: m.source?.iconUrl ?? null,
      extensionPkg: ext?.pkgName ?? null,
      extensionName: ext?.name ?? null,
      // GraphQL returns source = null when Suwayomi cannot instantiate it (SourceType.kt).
      missing: m.source === null || (ext !== null && !ext.isInstalled),
      obsolete: ext?.isObsolete ?? false,
      hasUpdate: ext?.hasUpdate ?? false,
    });
  }

  const resolved = tx(db, () => {
    for (const s of sources.values()) upsertSource(db, s, now);
    for (const m of library) {
      upsertSeries(
        db,
        {
          mangaId: m.id,
          title: m.title,
          status: m.status,
          sourceId: m.sourceId,
          realUrl: m.realUrl,
          thumbnailPath: m.thumbnailUrl,
          initialized: m.initialized,
          categories: m.categories.nodes.map((c) => c.name),
          chapterCount: m.chapters.totalCount,
          latestChapterAt: latestChapterTime(m.latestUploadedChapter?.uploadDate, m.latestFetchedChapter?.fetchedAt),
        },
        now,
      );
    }
    return resolveMissingSeries(db, library.map((m) => m.id), now);
  });

  reevaluateAll(db, opts.settings, now);
  return { series: library.length, resolved };
}

export function reevaluateAll(db: Db, settings: Settings, now: number): void {
  const sources = sourceMap(db);
  tx(db, () => {
    for (const row of listSeries(db, { inLibrary: true })) {
      evaluateSeries(db, row, sources.get(row.source_id), settings, now);
    }
  });
}
