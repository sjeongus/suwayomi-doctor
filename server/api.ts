import type { FastifyInstance } from 'fastify';
import { Cron } from 'croner';
import type { Config } from './config.js';
import { nowSec, type Db } from './db.js';
import { bus } from './events.js';
import { reevaluateAll, syncLibrary, type SyncResult } from './scan/sync.js';
import type { Scanner } from './scan/scanner.js';
import type { CheckHistoryEntry, Finding, Health, MihonCheckResult, ScanlatorHint, SeriesView, Settings, SourceView, Summary } from './shared/api-types.js';
import {
  getSeries,
  lastFinishedScan,
  listChecks,
  listSeries,
  listSources,
  markRemoved,
  saveSettings,
  setIgnoredUntil,
  sourceMap,
  type SeriesRow,
  type SourceRow,
} from './store.js';
import { SuwayomiUnreachableError, type SuwayomiClient } from './suwayomi/client.js';
import {
  ABOUT_SERVER,
  MANGA_BY_IDS,
  REMOVE_FROM_LIBRARY,
  type AboutServer,
  type MangaByIds,
  type RemoveFromLibraryResult,
} from './suwayomi/queries.js';
import { getHint, listHints, type ScanlatorHints } from './mangaupdates/hints.js';
import { AniList, MAX_PAIRS, matchWithAniList } from './mihon/anilist.js';
import { BackupFormatError, parseBackup } from './mihon/backup.js';
import { classify, entriesFor, pickSource, sourceOptions, unmatched, type ServerManga } from './mihon/orphans.js';

const SYNC_MIN_INTERVAL_SEC = 5 * 60;
const ABOUT_CACHE_MS = 60_000;

export interface AppContext {
  db: Db;
  config: Config;
  client: SuwayomiClient;
  scanner: Scanner;
  hints: ScanlatorHints;
  settings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => Settings;
  nextScanAt: () => number | null;
}

export function toSeriesView(row: SeriesRow, source: SourceRow | undefined, config: Config, scanlators: ScanlatorHint | null): SeriesView {
  return {
    mangaId: row.manga_id,
    title: row.title,
    status: row.status,
    sourceId: row.source_id,
    sourceName: source?.name ?? `Source #${row.source_id}`,
    sourceIconUrl: source?.icon_url ? `/api/source-icon/${row.source_id}` : null,
    extensionName: source?.extension_name ?? null,
    categories: JSON.parse(row.categories) as string[],
    realUrl: row.real_url,
    health: row.health,
    underlyingHealth: row.underlying_health,
    findings: JSON.parse(row.findings) as Finding[],
    lastCheckedAt: row.last_checked_at,
    firstUnhealthyAt: row.first_unhealthy_at,
    consecutiveFailures: row.consecutive_failures,
    lastError: row.last_error,
    chapterCount: row.chapter_count,
    latestChapterAt: row.latest_chapter_at,
    ignoredUntil: row.ignored_until,
    resolvedAt: row.resolved_at,
    suwayomiUrl: `${config.suwayomiPublicUrl}/manga/${row.manga_id}`,
    thumbnailUrl: `/api/thumb/${row.manga_id}`,
    scanlators,
  };
}

export function registerApi(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, client, scanner } = ctx;

  const aniList = new AniList();
  let lastSyncAt = 0;
  let syncing: Promise<SyncResult> | null = null;
  const runSync = () => {
    if (syncing) return syncing;
    lastSyncAt = nowSec();
    syncing = syncLibrary(db, client, { includeLocalSource: config.includeLocalSource, settings: ctx.settings(), now: nowSec() })
      .then((r) => {
        bus.publish({ type: 'changed' });
        return r;
      })
      .finally(() => (syncing = null));
    return syncing;
  };

  let about: { at: number; value: Summary['suwayomi'] } | null = null;
  const getAbout = async (): Promise<Summary['suwayomi']> => {
    if (about && Date.now() - about.at < ABOUT_CACHE_MS) return about.value;
    const base = { url: config.suwayomiUrl, publicUrl: config.suwayomiPublicUrl };
    let value: Summary['suwayomi'];
    try {
      const data = await client.query<AboutServer>(ABOUT_SERVER, {}, AbortSignal.timeout(5000));
      value = { ...base, reachable: true, version: `${data.aboutServer.version} (${data.aboutServer.buildType})`, error: null };
    } catch (err) {
      value = { ...base, reachable: false, version: null, error: (err as Error).message };
    }
    about = { at: Date.now(), value };
    return value;
  };

  app.get('/api/summary', async (): Promise<Summary> => {
    const rows = listSeries(db, { inLibrary: true });
    const counts: Record<Health, number> = { healthy: 0, warning: 0, broken: 0, unchecked: 0, ignored: 0 };
    for (const r of rows) counts[r.health]++;
    const resolved = listSeries(db, { inLibrary: false }).length;
    return {
      counts,
      resolved,
      lastScan: lastFinishedScan(db),
      nextScanAt: ctx.nextScanAt(),
      progress: scanner.progress(),
      suwayomi: await getAbout(),
      migrateBrowseUrl: `${config.suwayomiPublicUrl}/browse?tab=migrate`,
    };
  });

  app.get('/api/series', async (): Promise<SeriesView[]> => {
    const sources = sourceMap(db);
    const hints = listHints(db);
    return listSeries(db).map((r) => toSeriesView(r, sources.get(r.source_id), config, hints.get(r.manga_id) ?? null));
  });

  app.get<{ Params: { id: string } }>('/api/series/:id/history', async (req, reply): Promise<CheckHistoryEntry[] | void> => {
    const id = Number(req.params.id);
    if (!getSeries(db, id)) return reply.code(404).send({ error: 'Unknown series' });
    return listChecks(db, id).map((c) => ({
      scanId: c.scan_id,
      at: c.at,
      ok: c.ok === 1,
      errorKind: c.error_kind,
      error: c.error,
      chapterCount: c.chapter_count,
      health: c.health,
    }));
  });

  app.get('/api/sources', async (): Promise<SourceView[]> => {
    const series = listSeries(db, { inLibrary: true });
    return listSources(db)
      .map((s) => {
        const mine = series.filter((r) => r.source_id === s.source_id);
        return {
          sourceId: s.source_id,
          name: s.name,
          iconUrl: s.icon_url ? `/api/source-icon/${s.source_id}` : null,
          extensionName: s.extension_name,
          missing: s.missing === 1,
          obsolete: s.obsolete === 1,
          hasUpdate: s.has_update === 1,
          outageStreak: s.outage_streak,
          seriesCount: mine.length,
          brokenCount: mine.filter((r) => r.health === 'broken').length,
          warningCount: mine.filter((r) => r.health === 'warning').length,
        };
      })
      .filter((s) => s.seriesCount > 0);
  });

  app.post('/api/sync', async () => {
    if (scanner.running) return { started: false, reason: 'scan running' };
    if (nowSec() - lastSyncAt < SYNC_MIN_INTERVAL_SEC) return { started: false, reason: 'synced recently' };
    runSync().catch((err) => console.error('[sync] failed:', (err as Error).message));
    return { started: true };
  });

  // Manual sync: re-reads the library from Suwayomi only (no source traffic) and waits for it.
  app.post('/api/sync/now', async (_req, reply): Promise<SyncResult | void> => {
    if (scanner.running) return reply.code(409).send({ error: 'A scan is running. It syncs the library itself.' });
    try {
      return await runSync();
    } catch (err) {
      return reply.code(502).send({ error: `Couldn't sync with Suwayomi: ${(err as Error).message}` });
    }
  });

  app.post('/api/scan', async () => ({ runId: scanner.start('manual') }));
  app.delete('/api/scan', async () => ({ cancelled: scanner.cancel() }));

  app.post<{ Params: { id: string } }>('/api/series/:id/recheck', async (req, reply) => {
    const id = Number(req.params.id);
    if (!getSeries(db, id)) return reply.code(404).send({ error: 'Unknown series' });
    try {
      await scanner.recheck(id);
    } catch (err) {
      const status = err instanceof SuwayomiUnreachableError ? 502 : 500;
      return reply.code(status).send({ error: (err as Error).message });
    }
    const sources = sourceMap(db);
    const row = getSeries(db, id)!;
    return toSeriesView(row, sources.get(row.source_id), config, getHint(db, id));
  });

  // Who scanlates this series now, per MangaUpdates: a hint for where to migrate it.
  app.post<{ Params: { id: string } }>('/api/series/:id/scanlators', async (req, reply): Promise<SeriesView | void> => {
    const id = Number(req.params.id);
    if (!getSeries(db, id)) return reply.code(404).send({ error: 'Unknown series' });
    try {
      await ctx.hints.lookup(id);
    } catch (err) {
      const status = err instanceof SuwayomiUnreachableError ? 502 : 500;
      return reply.code(status).send({ error: (err as Error).message });
    }
    const row = getSeries(db, id)!;
    return toSeriesView(row, sourceMap(db).get(row.source_id), config, getHint(db, id));
  });

  app.post<{ Params: { id: string } }>('/api/series/:id/remove', async (req, reply) => {
    const id = Number(req.params.id);
    if (!getSeries(db, id)) return reply.code(404).send({ error: 'Unknown series' });
    try {
      const result = await client.query<RemoveFromLibraryResult>(REMOVE_FROM_LIBRARY, { id }, AbortSignal.timeout(15_000));
      if (result.updateManga.manga.inLibrary) throw new Error('Suwayomi kept the series in the library');
    } catch (err) {
      const status = err instanceof SuwayomiUnreachableError ? 502 : 500;
      return reply.code(status).send({ error: `Couldn't remove it: ${(err as Error).message}` });
    }
    markRemoved(db, id, nowSec());
    bus.publish({ type: 'changed' });
    const row = getSeries(db, id)!;
    return toSeriesView(row, sourceMap(db).get(row.source_id), config, getHint(db, row.manga_id));
  });

  app.post<{ Params: { id: string }; Body: { days: number | null } }>('/api/series/:id/ignore', async (req, reply) => {
    const id = Number(req.params.id);
    const row = getSeries(db, id);
    if (!row) return reply.code(404).send({ error: 'Unknown series' });
    const days = req.body?.days;
    // null = ignore forever, 0 = stop ignoring, n = ignore for n days
    const until = days === null ? 32503680000 : days === 0 ? null : nowSec() + Math.max(1, Number(days)) * 86400;
    setIgnoredUntil(db, id, until);
    reevaluateAll(db, ctx.settings(), nowSec());
    bus.publish({ type: 'series', mangaId: id });
    const updated = getSeries(db, id)!;
    return toSeriesView(updated, sourceMap(db).get(updated.source_id), config, getHint(db, updated.manga_id));
  });

  // Mihon cleanup: the backup is read in memory and never stored.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 100 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );
  app.post<{ Querystring: { source?: string; anilist?: string }; Body: Buffer }>('/api/mihon/check', async (req, reply): Promise<MihonCheckResult | void> => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return reply.code(400).send({ error: 'Choose a Mihon backup file first.' });
    let backup;
    try {
      backup = parseBackup(req.body);
    } catch (err) {
      if (err instanceof BackupFormatError) return reply.code(400).send({ error: err.message });
      throw err;
    }
    const options = sourceOptions(backup);
    const sourceId = pickSource(options, req.query.source);
    if (sourceId === null) return classify(options, null, [], new Map(), () => null);

    const entries = entriesFor(backup, sourceId);
    const ids = [...new Set(entries.flatMap((e) => (e.mangaId === null ? [] : [e.mangaId])))];
    const server = new Map<number, ServerManga>();
    try {
      for (let i = 0; i < ids.length; i += 500) {
        const data = await client.query<MangaByIds>(MANGA_BY_IDS, { ids: ids.slice(i, i + 500) }, AbortSignal.timeout(30_000));
        for (const m of data.mangas.nodes) {
          server.set(m.id, {
            id: m.id,
            title: m.title,
            inLibrary: m.inLibrary,
            author: m.author ?? '',
            artist: m.artist ?? '',
            description: m.description ?? '',
            tracks: m.trackRecords.nodes.map((t) => ({ trackerId: t.trackerId, remoteId: String(t.remoteId), title: t.title })),
          });
        }
      }
    } catch (err) {
      return reply.code(502).send({ error: `Couldn't ask Suwayomi about these series: ${(err as Error).message}` });
    }

    // Titles that still don't match get one more chance on AniList, which knows a series' names in every language.
    const pairs = unmatched(entries, server);
    let anilist: MihonCheckResult['anilist'] = null;
    let found = new Map<(typeof entries)[number], string>();
    if (pairs.length > 0 && req.query.anilist !== '0') {
      anilist = { looked: pairs.length, matched: 0, error: null };
      if (pairs.length > MAX_PAIRS) {
        anilist.error = `Skipped: ${pairs.length} titles don't match, which is more than ${MAX_PAIRS} to look up.`;
      } else {
        try {
          found = await matchWithAniList(
            aniList,
            pairs.map((p) => ({ key: p.entry, mihon: p.entry, server: p.server })),
            AbortSignal.timeout(120_000),
          );
          anilist.matched = found.size;
        } catch (err) {
          anilist.error = `Couldn't reach AniList (${(err as Error).message}).`;
        }
      }
    }
    const result = classify(options, sourceId, entries, server, (id) => getSeries(db, id)?.resolved_at ?? null, (e) => found.get(e) ?? null);
    result.anilist = anilist;
    return result;
  });

  app.get('/api/settings', async () => ctx.settings());
  app.put<{ Body: Partial<Settings> }>('/api/settings', async (req, reply) => {
    const body = req.body ?? {};
    const patch: Partial<Settings> = {};
    if (body.scanCron !== undefined) {
      try {
        new Cron(String(body.scanCron), { paused: true }).stop();
      } catch (err) {
        return reply.code(400).send({ error: `Invalid schedule: ${(err as Error).message}` });
      }
      patch.scanCron = String(body.scanCron).trim();
    }
    for (const key of ['staleDays', 'sourceConcurrency', 'delayMs'] as const) {
      if (body[key] === undefined) continue;
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < (key === 'sourceConcurrency' || key === 'staleDays' ? 1 : 0)) {
        return reply.code(400).send({ error: `${key} must be a positive number` });
      }
      patch[key] = Math.floor(n);
    }
    saveSettings(db, patch);
    const updated = ctx.updateSettings(patch);
    if (patch.staleDays !== undefined) {
      reevaluateAll(db, updated, nowSec());
      bus.publish({ type: 'changed' });
    }
    return updated;
  });

  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`data: ${JSON.stringify({ type: 'progress', progress: scanner.progress() })}\n\n`);
    const unsubscribe = bus.subscribe((event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
    reply.hijack();
  });

  // Images are proxied so the browser never needs Suwayomi's credentials.
  const proxyImage = async (path: string | null | undefined, reply: import('fastify').FastifyReply) => {
    if (!path) return reply.code(404).send();
    try {
      const res = await client.fetchPath(path.startsWith('http') ? new URL(path).pathname : path, AbortSignal.timeout(15_000));
      if (!res.ok || !res.body) return reply.code(res.status === 200 ? 404 : res.status).send();
      reply.header('content-type', res.headers.get('content-type') ?? 'image/jpeg');
      reply.header('cache-control', 'public, max-age=86400');
      return reply.send(Buffer.from(await res.arrayBuffer()));
    } catch {
      return reply.code(502).send();
    }
  };

  app.get<{ Params: { id: string } }>('/api/thumb/:id', async (req, reply) => {
    const row = getSeries(db, Number(req.params.id));
    return proxyImage(row?.thumbnail_path, reply);
  });

  app.get<{ Params: { id: string } }>('/api/source-icon/:id', async (req, reply) => {
    const source = sourceMap(db).get(req.params.id);
    return proxyImage(source?.icon_url, reply);
  });
}
