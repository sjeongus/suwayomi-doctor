import { describe, expect, it } from 'vitest';
import { MangaUpdates } from './client.js';

type Handler = (path: string, body: Record<string, unknown> | undefined) => unknown;

function fake(handler: Handler, calls: string[] = []) {
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.mangaupdates.com/v1', '');
    calls.push(path);
    const out = handler(path, init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined);
    return out === undefined ? new Response('{"reason":"Not found"}', { status: 404 }) : Response.json(out);
  }) as unknown as typeof fetch;
  return new MangaUpdates(f, async () => {}, 0);
}

const releases = {
  results: [
    { record: { chapter: '118', release_date: '2026-09-20', groups: [{ name: 'Old Group', group_id: 2, url: 'https://mu/old' }] } },
    { record: { chapter: '120', release_date: '2026-10-05', groups: [{ name: 'Asura Scans', group_id: 1, url: 'https://mu/asura' }] } },
    { record: { chapter: '119', release_date: '2026-09-28', groups: [{ name: 'Asura Scans', group_id: 1, url: 'https://mu/asura' }] } },
    { record: { volume: '3', chapter: '20', release_date: '2026-08-01', groups: [{ name: 'Third', group_id: 3 }] } },
  ],
};

describe('MangaUpdates', () => {
  it('finds the series by title, including alternative titles it lists', async () => {
    const mu = fake((path) =>
      path === '/series/search'
        ? {
            results: [
              { record: { series_id: 9, title: 'Some Other Thing', url: 'https://mu/9' } },
              { record: { series_id: 42, title: 'Solo Leveling', url: 'https://mu/42' }, hit_title: '나 혼자만 레벨업' },
            ],
          }
        : undefined,
    );
    expect(await mu.findSeries('나 혼자만 레벨업')).toEqual({ id: '42', title: 'Solo Leveling', url: 'https://mu/42', matchedBy: 'Listed there as "나 혼자만 레벨업".' });
    expect(await mu.findSeries('Completely Unrelated')).toBeNull();
  });

  it('lists the groups behind the newest releases, newest first, with their sites', async () => {
    const calls: string[] = [];
    const mu = fake((path) => {
      if (path === '/releases/search') return releases;
      if (path === '/groups/1') return { name: 'Asura Scans', social: { site: 'asuracomic.net' } };
      if (path === '/groups/2') return { name: 'Old Group', social: { site: '' } };
      return undefined;
    }, calls);
    const groups = await mu.latestGroups('42');
    expect(groups).toEqual([
      { name: 'Asura Scans', muUrl: 'https://mu/asura', site: 'https://asuracomic.net', chapter: 'Ch. 120', releasedOn: '2026-10-05' },
      { name: 'Old Group', muUrl: 'https://mu/old', site: null, chapter: 'Ch. 118', releasedOn: '2026-09-20' },
      { name: 'Third', muUrl: null, site: null, chapter: 'Vol. 3 Ch. 20', releasedOn: '2026-08-01' },
    ]);
    await mu.latestGroups('42');
    expect(calls.filter((c) => c.startsWith('/groups/'))).toHaveLength(3); // group sites are cached
  });

  it('returns null for a tracker id MangaUpdates no longer has', async () => {
    const mu = fake((path) => (path === '/series/7' ? { series_id: 7, title: 'Tracked', url: 'https://mu/7' } : undefined));
    expect((await mu.seriesById('7'))?.matchedBy).toMatch(/tracker/);
    expect(await mu.seriesById('8')).toBeNull();
  });
});
