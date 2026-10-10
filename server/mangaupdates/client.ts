// MangaUpdates (Baka-Updates) public API: https://api.mangaupdates.com. No account is needed for reads.
// Used to find who scanlates a series now, as a hint for where to migrate a broken one.

import { normalize, similarity, SIMILAR } from '../mihon/match.js';

const BASE = 'https://api.mangaupdates.com/v1';
/** One request a second at most; MangaUpdates asks API users to be gentle. */
const SPACING_MS = 1000;
/** Releases read per series; enough to see which groups are active. */
const RELEASES = 25;
/** Groups listed per series. */
const MAX_GROUPS = 3;

export interface MuSeries {
  id: string;
  title: string;
  url: string;
  /** How Doctor tied it to the Suwayomi series, in words. */
  matchedBy: string;
}

export interface MuGroupRelease {
  name: string;
  /** The group's page on MangaUpdates. */
  muUrl: string | null;
  /** The group's own website, when MangaUpdates lists one. */
  site: string | null;
  /** Its latest release, e.g. "Ch. 120" or "Vol. 3 Ch. 20". */
  chapter: string;
  /** YYYY-MM-DD. */
  releasedOn: string;
}

interface RawSeriesHit {
  record: { series_id: number | string; title: string; url: string };
  hit_title?: string;
}

interface RawRelease {
  record: {
    chapter?: string;
    volume?: string | null;
    release_date?: string;
    groups?: { name: string; group_id?: number | string; url?: string }[];
  };
}

interface RawGroup {
  name: string;
  url?: string;
  social?: { site?: string | null } | null;
}

export class MangaUpdatesError extends Error {}

export class MangaUpdates {
  private lastRequestAt = 0;
  private groupSites = new Map<string, string | null>();

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    private readonly spacingMs = SPACING_MS,
  ) {}

  private async call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastRequestAt + this.spacingMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
      const res = await this.fetchImpl(`${BASE}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ?? AbortSignal.timeout(20_000),
      });
      if (res.status === 429 && attempt === 0) {
        await this.sleep(Math.min(Number(res.headers.get('retry-after')) || 10, 60) * 1000);
        continue;
      }
      if (res.status === 404) throw new MangaUpdatesError('not found');
      const json = (await res.json().catch(() => null)) as (T & { reason?: string }) | null;
      if (!res.ok || json === null) throw new MangaUpdatesError(json?.reason ?? `MangaUpdates answered ${res.status}`);
      return json;
    }
  }

  async seriesById(id: string, signal?: AbortSignal): Promise<MuSeries | null> {
    try {
      const s = await this.call<{ series_id: number | string; title: string; url: string }>(`/series/${encodeURIComponent(id)}`, undefined, signal);
      return { id: String(s.series_id), title: s.title, url: s.url, matchedBy: 'Linked through your MangaUpdates tracker.' };
    } catch (err) {
      if (err instanceof MangaUpdatesError && err.message === 'not found') return null;
      throw err;
    }
  }

  /** The search hit whose title (or the alternative title it matched on) is close to `title`, if any. */
  async findSeries(title: string, signal?: AbortSignal): Promise<MuSeries | null> {
    if (!normalize(title)) return null;
    const data = await this.call<{ results?: RawSeriesHit[] }>('/series/search', { search: title, perpage: 10 }, signal);
    let best: { hit: RawSeriesHit; score: number; name: string } | null = null;
    for (const hit of data.results ?? []) {
      for (const name of [hit.record.title, hit.hit_title ?? '']) {
        if (!normalize(name)) continue;
        const score = normalize(name) === normalize(title) ? 1 : similarity(name, title);
        if (score >= SIMILAR && (!best || score > best.score)) best = { hit, score, name };
      }
    }
    if (!best) return null;
    const r = best.hit.record;
    const matchedBy =
      best.score === 1 ? (best.name === r.title ? 'Same title.' : `Listed there as "${best.name}".`) : `Titles are ${Math.round(best.score * 100)}% similar.`;
    return { id: String(r.series_id), title: r.title, url: r.url, matchedBy };
  }

  /** The groups behind the series' most recent releases, newest first. */
  async latestGroups(seriesId: string, signal?: AbortSignal): Promise<MuGroupRelease[]> {
    const data = await this.call<{ results?: RawRelease[] }>(
      '/releases/search',
      { search: seriesId, search_type: 'series', perpage: RELEASES, orderby: 'date', asc: 'desc' },
      signal,
    );
    const releases = (data.results ?? [])
      .map((r) => r.record)
      .filter((r) => r.release_date)
      .sort((a, b) => b.release_date!.localeCompare(a.release_date!));

    const out = new Map<string, MuGroupRelease & { groupId: string | null }>();
    for (const r of releases) {
      for (const g of r.groups ?? []) {
        const key = g.group_id !== undefined ? String(g.group_id) : g.name;
        if (out.has(key) || out.size >= MAX_GROUPS) continue;
        out.set(key, {
          name: g.name,
          muUrl: g.url ?? null,
          site: null,
          chapter: [r.volume ? `Vol. ${r.volume}` : '', r.chapter ? `Ch. ${r.chapter}` : ''].filter(Boolean).join(' ') || '?',
          releasedOn: r.release_date!,
          groupId: g.group_id !== undefined ? String(g.group_id) : null,
        });
      }
    }
    const groups = [...out.values()];
    for (const g of groups) if (g.groupId) g.site = await this.groupSite(g.groupId, signal);
    return groups.map(({ groupId: _, ...g }) => g);
  }

  private async groupSite(groupId: string, signal?: AbortSignal): Promise<string | null> {
    if (this.groupSites.has(groupId)) return this.groupSites.get(groupId)!;
    let site: string | null = null;
    try {
      const g = await this.call<RawGroup>(`/groups/${encodeURIComponent(groupId)}`, undefined, signal);
      const s = g.social?.site?.trim();
      site = s ? (/^https?:\/\//i.test(s) ? s : `https://${s}`) : null;
    } catch (err) {
      if (!(err instanceof MangaUpdatesError)) throw err;
    }
    this.groupSites.set(groupId, site);
    return site;
  }
}
