import type { MihonCheckResult, MihonEntry, MihonSourceOption } from '../shared/api-types.js';
import type { MihonBackup, MihonManga } from './backup.js';
import { normalize, sameSeries, type SeriesFacts } from './match.js';

export interface ServerManga extends SeriesFacts {
  id: number;
  inLibrary: boolean;
}

const SUWAYOMI_NAME = /suwayomi|tachidesk/i;

/** The Suwayomi extension stores entries as "/api/v1/manga/<id>"; a bare id is accepted too. */
export function mangaIdFromUrl(url: string): number | null {
  const m = /\/manga\/(\d+)/.exec(url) ?? /^\s*(\d+)\s*$/.exec(url);
  return m ? Number(m[1]) : null;
}

export function sourceOptions(backup: MihonBackup): MihonSourceOption[] {
  const names = new Map(backup.sources.map((s) => [s.sourceId, s.name]));
  const counts = new Map<string, number>();
  for (const m of backup.manga) if (m.favorite) counts.set(m.sourceId, (counts.get(m.sourceId) ?? 0) + 1);
  return [...counts.entries()]
    .map(([sourceId, count]) => {
      const name = names.get(sourceId) ?? `Source ${sourceId}`;
      return { sourceId, name, count, isSuwayomi: SUWAYOMI_NAME.test(name) };
    })
    .sort((a, b) => Number(b.isSuwayomi) - Number(a.isSuwayomi) || b.count - a.count);
}

/** The Suwayomi source to check: the one asked for, else the biggest one named like Suwayomi. */
export function pickSource(options: MihonSourceOption[], requested: string | undefined): string | null {
  if (requested && options.some((o) => o.sourceId === requested)) return requested;
  return options.find((o) => o.isSuwayomi)?.sourceId ?? null;
}

/** Library entries from the chosen source, with their Suwayomi ids. Every other source is ignored. */
export function entriesFor(backup: MihonBackup, sourceId: string) {
  return backup.manga
    .filter((m) => m.favorite && m.sourceId === sourceId)
    .map((m) => ({ ...m, mangaId: mangaIdFromUrl(m.url) }));
}

type Entry = MihonManga & { mangaId: number | null };

const titlesAgree = (e: Entry, s: ServerManga) =>
  !normalize(e.title) || !normalize(s.title) || normalize(e.title) === normalize(s.title);

/** Entries whose server series has a different title and nothing on hand links the two. */
export function unmatched(entries: Entry[], server: Map<number, ServerManga>): { entry: Entry; server: ServerManga }[] {
  return entries.flatMap((e) => {
    const s = e.mangaId === null ? undefined : server.get(e.mangaId);
    return s && !titlesAgree(e, s) && !sameSeries(e, s) ? [{ entry: e, server: s }] : [];
  });
}

export function classify(
  options: MihonSourceOption[],
  sourceId: string | null,
  entries: Entry[],
  server: Map<number, ServerManga>,
  resolvedAt: (mangaId: number) => number | null,
  /** Evidence found elsewhere (AniList) for entries the local checks couldn't match. */
  lookedUp: (e: Entry) => string | null = () => null,
): MihonCheckResult {
  const result: MihonCheckResult = {
    sources: options,
    sourceId,
    checked: entries.length,
    stillInLibrary: 0,
    removed: [],
    deleted: [],
    unsure: [],
    looksLikeOtherServer: false,
    anilist: null,
  };
  for (const e of entries) {
    const s = e.mangaId === null ? undefined : server.get(e.mangaId);
    // Titles that agree need no evidence; otherwise look for some (trackers, similar or alternative titles, author, AniList).
    const agree = !s || titlesAgree(e, s);
    const matchedBy = s && !agree ? (sameSeries(e, s) ?? lookedUp(e)) : null;
    const entry: MihonEntry = {
      title: e.title,
      mangaId: e.mangaId,
      serverTitle: s?.title ?? null,
      matchedBy,
      resolvedAt: e.mangaId === null ? null : resolvedAt(e.mangaId),
    };
    if (e.mangaId === null || (s && !agree && !matchedBy)) result.unsure.push(entry);
    else if (!s) result.deleted.push(entry);
    else if (!s.inLibrary) result.removed.push(entry);
    else result.stillInLibrary++;
  }
  const byTitle = (a: MihonEntry, b: MihonEntry) => a.title.localeCompare(b.title);
  result.removed.sort(byTitle);
  result.deleted.sort(byTitle);
  result.unsure.sort(byTitle);
  const mismatched = result.deleted.length + result.unsure.length;
  result.looksLikeOtherServer = entries.length >= 5 && mismatched / entries.length > 0.5;
  return result;
}
