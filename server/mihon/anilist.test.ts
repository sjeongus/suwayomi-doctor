import { describe, expect, it } from 'vitest';
import { AniList, matchWithAniList } from './anilist.js';
import type { SeriesFacts } from './match.js';

const SOLO = { id: 105398, title: { romaji: 'Na Honjaman Level Up', english: 'Solo Leveling', native: '나 혼자만 레벨업' }, synonyms: ['Only I Level Up'] };
const AOT = { id: 53390, title: { romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', native: '進撃の巨人' }, synonyms: [] };
const OTHER = { id: 1, title: { romaji: 'Leveling Up Alone Somewhere', english: null, native: null }, synonyms: [] };

/** A fake AniList: search returns every series with a name containing the term, plus a loose hit. */
function fakeFetch(calls: unknown[]) {
  const all = [SOLO, AOT, OTHER];
  return (async (_url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    calls.push(variables);
    if (query.includes('id_in')) {
      const ids = variables.ids as number[];
      return Response.json({ data: { Page: { media: all.filter((m) => ids.includes(m.id)) } } });
    }
    const data = Object.fromEntries(
      Object.entries(variables).map(([k, term]) => {
        const hits = all.filter((m) => [m.title.romaji, m.title.english, m.title.native, ...m.synonyms].some((n) => n?.includes(String(term))));
        return [k.replace('s', 'q'), { media: [...hits, OTHER] }];
      }),
    );
    return Response.json({ data });
  }) as unknown as typeof fetch;
}

const f = (title: string, more: Partial<SeriesFacts> = {}): SeriesFacts => ({ title, author: '', artist: '', description: '', tracks: [], ...more });
const client = (calls: unknown[] = []) => new AniList(fakeFetch(calls), async () => {}, 0);

describe('matchWithAniList', () => {
  it('links titles in different languages through the AniList entry that lists both', async () => {
    const found = await matchWithAniList(client(), [
      { key: 'a', mihon: f('나 혼자만 레벨업'), server: f('Solo Leveling') },
      { key: 'b', mihon: f('進撃の巨人'), server: f('Attack on Titan') },
    ]);
    expect(found.get('a')).toBe('AniList lists both titles under "Na Honjaman Level Up".');
    expect(found.get('b')).toMatch(/Shingeki no Kyojin/);
  });

  it('uses an AniList tracker link when there is one', async () => {
    const found = await matchWithAniList(client(), [
      { key: 'a', mihon: f('Some Scanlation Name', { tracks: [{ trackerId: 2, remoteId: '105398', title: '' }] }), server: f('Only I Level Up') },
    ]);
    expect(found.has('a')).toBe(true);
  });

  it("doesn't match on a loose search hit", async () => {
    const found = await matchWithAniList(client(), [{ key: 'a', mihon: f('Solo Leveling'), server: f('Attack on Titan') }]);
    expect(found.size).toBe(0);
  });

  it('batches searches and caches them', async () => {
    const calls: unknown[] = [];
    const ani = client(calls);
    const pairs = [{ key: 'a', mihon: f('나 혼자만 레벨업'), server: f('Solo Leveling') }];
    await matchWithAniList(ani, pairs);
    await matchWithAniList(ani, pairs);
    expect(calls).toEqual([{ s0: '나 혼자만 레벨업', s1: 'Solo Leveling' }]);
  });

  it('retries once after a rate limit, then reports the error', async () => {
    let n = 0;
    const limited = (async () => (n++, new Response('{}', { status: 429, headers: { 'retry-after': '1' } }))) as unknown as typeof fetch;
    await expect(matchWithAniList(new AniList(limited, async () => {}, 0), [{ key: 'a', mihon: f('A title'), server: f('Another') }])).rejects.toThrow(
      /429/,
    );
    expect(n).toBe(2);
  });
});
