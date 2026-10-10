// Looks titles up on AniList, which lists a series' romaji, English, native (Japanese, Korean, Chinese)
// and alternative titles together. That links names no string comparison can, like 나 혼자만 레벨업 and Solo Leveling.

import { normalize, similarity, SIMILAR, type SeriesFacts } from './match.js';

const ENDPOINT = 'https://graphql.anilist.co';
const ANILIST_TRACKER = 2;
/** Titles searched per request (as aliases), and results kept per title. */
const BATCH = 10;
const RESULTS = 5;
/** AniList allows 90 requests a minute (30 while degraded); this stays well under either. */
const SPACING_MS = 2100;
/** Above this many pairs, the backup is probably from another server; looking them all up would take minutes. */
export const MAX_PAIRS = 100;

export interface AniListMedia {
  id: number;
  /** Main title for display (romaji, else English, else native). */
  title: string;
  /** Every name AniList knows: romaji, English, native and synonyms. */
  names: string[];
}

interface RawMedia {
  id: number;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: (string | null)[] | null;
}

const FIELDS = 'id title { romaji english native } synonyms';

function toMedia(m: RawMedia): AniListMedia {
  const names = [m.title.romaji, m.title.english, m.title.native, ...(m.synonyms ?? [])].filter(
    (n): n is string => !!n && normalize(n).length > 0,
  );
  return { id: m.id, title: m.title.romaji ?? m.title.english ?? m.title.native ?? `#${m.id}`, names };
}

export class AniListError extends Error {}

export class AniList {
  private searches = new Map<string, AniListMedia[]>();
  private byId = new Map<number, AniListMedia | null>();
  private lastRequestAt = 0;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    private readonly spacingMs = SPACING_MS,
  ) {}

  private async post<T>(query: string, variables: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.spacingMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      const res = await this.fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal,
      });
      if (res.status === 429 && attempt === 0) {
        const retry = Math.min(Number(res.headers.get('retry-after')) || 30, 65);
        await this.sleep(retry * 1000);
        continue;
      }
      const body = (await res.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
      if (!res.ok || !body?.data) {
        throw new AniListError(body?.errors?.[0]?.message ?? `AniList answered ${res.status}`);
      }
      return body.data;
    }
  }

  /** Searches several titles, a batch per request. Results are cached for the life of the process. */
  async search(titles: string[], signal?: AbortSignal): Promise<Map<string, AniListMedia[]>> {
    const todo = [...new Set(titles.filter((t) => normalize(t).length > 0 && !this.searches.has(t)))];
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const vars = Object.fromEntries(batch.map((t, j) => [`s${j}`, t]));
      const query = `query (${batch.map((_, j) => `$s${j}: String`).join(', ')}) {
        ${batch.map((_, j) => `q${j}: Page(perPage: ${RESULTS}) { media(search: $s${j}, type: MANGA) { ${FIELDS} } }`).join('\n')}
      }`;
      const data = await this.post<Record<string, { media: RawMedia[] }>>(query, vars, signal);
      batch.forEach((t, j) => this.searches.set(t, (data[`q${j}`]?.media ?? []).map(toMedia)));
    }
    return new Map(titles.map((t) => [t, this.searches.get(t) ?? []]));
  }

  async media(ids: number[], signal?: AbortSignal): Promise<Map<number, AniListMedia>> {
    const todo = [...new Set(ids.filter((id) => !this.byId.has(id)))];
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const data = await this.post<{ Page: { media: RawMedia[] } }>(
        `query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids, type: MANGA) { ${FIELDS} } } }`,
        { ids: batch },
        signal,
      );
      for (const id of batch) this.byId.set(id, null);
      for (const m of data.Page.media) this.byId.set(m.id, toMedia(m));
    }
    const out = new Map<number, AniListMedia>();
    for (const id of ids) {
      const m = this.byId.get(id);
      if (m) out.set(id, m);
    }
    return out;
  }
}

const close = (a: string, b: string) => normalize(a) === normalize(b) || similarity(a, b) >= SIMILAR;
const knownAs = (m: AniListMedia, title: string) => m.names.some((n) => close(n, title));
const anilistIds = (s: SeriesFacts) =>
  s.tracks.filter((t) => t.trackerId === ANILIST_TRACKER && Number(t.remoteId) > 0).map((t) => Number(t.remoteId));

/**
 * The AniList entries a series is, as far as Doctor can tell: the one it's tracked as,
 * plus search results that list a name close to its title (a search alone returns loose hits too).
 */
function identify(s: SeriesFacts, tracked: Map<number, AniListMedia>, searched: Map<string, AniListMedia[]>): AniListMedia[] {
  const linked = anilistIds(s).flatMap((id) => tracked.get(id) ?? []);
  const found = (searched.get(s.title) ?? []).filter((m) => knownAs(m, s.title));
  return [...linked, ...found];
}

export interface LookupPair<K> {
  key: K;
  mihon: SeriesFacts;
  server: SeriesFacts;
}

/** For each pair AniList shows to be one series, why (in words). Throws AniListError when AniList can't be used. */
export async function matchWithAniList<K>(
  anilist: AniList,
  pairs: LookupPair<K>[],
  signal?: AbortSignal,
): Promise<Map<K, string>> {
  const sides = pairs.flatMap((p) => [p.mihon, p.server]);
  const tracked = await anilist.media(sides.flatMap(anilistIds), signal);
  const searched = await anilist.search(sides.map((s) => s.title), signal);

  const out = new Map<K, string>();
  for (const p of pairs) {
    const a = identify(p.mihon, tracked, searched);
    const b = identify(p.server, tracked, searched);
    const shared = a.find((m) => b.some((n) => n.id === m.id)) ?? b.find((m) => knownAs(m, p.mihon.title)) ?? a.find((m) => knownAs(m, p.server.title));
    if (shared) out.set(p.key, `AniList lists both titles under "${shared.title}".`);
  }
  return out;
}
