import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BackupFormatError, parseBackup } from './backup.js';
import { sameSeries, similarity, SIMILAR, type SeriesFacts } from './match.js';
import { classify, entriesFor, mangaIdFromUrl, pickSource, sourceOptions, type ServerManga } from './orphans.js';

// A tiny protobuf writer, enough to build Mihon-shaped backups.
const varint = (v: bigint): number[] => {
  let n = BigInt.asUintN(64, v);
  const out: number[] = [];
  do {
    let byte = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) byte |= 0x80;
    out.push(byte);
  } while (n > 0n);
  return out;
};
const key = (field: number, wire: number) => varint(BigInt((field << 3) | wire));
const int = (field: number, v: bigint | number) => [...key(field, 0), ...varint(BigInt(v))];
const bytes = (field: number, b: number[]) => [...key(field, 2), ...varint(BigInt(b.length)), ...b];
const str = (field: number, s: string) => bytes(field, [...new TextEncoder().encode(s)]);

const SUWA = 3_100_000_000_000_000_001n;
const OTHER = -42n;

function manga(source: bigint, url: string, title: string, favorite = true) {
  return bytes(1, [
    ...int(1, source),
    ...str(2, url),
    ...str(3, title),
    ...str(6, 'a description to skip'),
    ...bytes(16, [...int(1, 5)]), // a chapter, also skipped
    ...(favorite ? [] : int(100, 0)),
  ]);
}

function backup(): Buffer {
  return gzipSync(
    Buffer.from([
      ...manga(SUWA, '/api/v1/manga/1', 'Healthy Hero'),
      ...manga(SUWA, '/api/v1/manga/7', 'Removed Rider'),
      ...manga(SUWA, '/api/v1/manga/99', 'Deleted Days'),
      ...manga(SUWA, '/api/v1/manga/2', 'Totally Different'),
      ...manga(SUWA, '/api/v1/manga/3', 'Only In History', false),
      ...manga(OTHER, '/title/1', 'From MangaDex'),
      ...manga(OTHER, '/title/7', 'Removed Rider'),
      ...bytes(101, [...str(1, 'Suwayomi'), ...int(2, SUWA)]),
      ...bytes(101, [...str(1, 'MangaDex'), ...int(2, OTHER)]),
    ]),
  );
}

function facts(id: number, title: string, inLibrary: boolean, more: Partial<ServerManga> = {}): ServerManga {
  return { id, title, inLibrary, author: '', artist: '', description: '', tracks: [], ...more };
}

const server = new Map<number, ServerManga>([
  [1, facts(1, 'Healthy Hero', true)],
  [2, facts(2, 'Old Ongoing', true)],
  [7, facts(7, 'Removed Rider', false)],
]);

describe('parseBackup', () => {
  it('reads library entries and sources, including 64-bit and negative ids', () => {
    const b = parseBackup(backup());
    expect(b.manga).toHaveLength(7);
    expect(b.manga[0]).toMatchObject({ sourceId: SUWA.toString(), url: '/api/v1/manga/1', title: 'Healthy Hero', favorite: true });
    expect(b.manga[0].description).toBe('a description to skip');
    expect(b.manga[4]?.favorite).toBe(false);
    expect(b.manga[5]?.sourceId).toBe('-42');
    expect(b.sources).toEqual([
      { sourceId: SUWA.toString(), name: 'Suwayomi' },
      { sourceId: '-42', name: 'MangaDex' },
    ]);
  });

  it('rejects files that are not backups', () => {
    expect(() => parseBackup(Buffer.from('hello, this is not a backup'))).toThrow(BackupFormatError);
    expect(() => parseBackup(gzipSync(Buffer.from([])))).toThrow(BackupFormatError);
  });
});

describe('orphans', () => {
  it('reads Suwayomi ids from entry URLs', () => {
    expect(mangaIdFromUrl('/api/v1/manga/123')).toBe(123);
    expect(mangaIdFromUrl('456')).toBe(456);
    expect(mangaIdFromUrl('/title/abc')).toBeNull();
  });

  it('checks only the Suwayomi source and sorts its entries out', () => {
    const b = parseBackup(backup());
    const options = sourceOptions(b);
    expect(options.map((o) => [o.name, o.count, o.isSuwayomi])).toEqual([
      ['Suwayomi', 4, true],
      ['MangaDex', 2, false],
    ]);
    const sourceId = pickSource(options, undefined)!;
    expect(sourceId).toBe(SUWA.toString());

    const r = classify(options, sourceId, entriesFor(b, sourceId), server, (id) => (id === 7 ? 1_700_000_000 : null));
    expect(r.checked).toBe(4);
    expect(r.stillInLibrary).toBe(1);
    expect(r.removed).toEqual([{ title: 'Removed Rider', mangaId: 7, serverTitle: 'Removed Rider', matchedBy: null, resolvedAt: 1_700_000_000 }]);
    expect(r.deleted.map((e) => e.title)).toEqual(['Deleted Days']);
    expect(r.unsure.map((e) => [e.title, e.serverTitle])).toEqual([['Totally Different', 'Old Ongoing']]);
    expect(r.looksLikeOtherServer).toBe(false);
  });

  it('returns no source when nothing looks like Suwayomi, unless one is picked', () => {
    const options = sourceOptions(parseBackup(backup())).filter((o) => !o.isSuwayomi);
    expect(pickSource(options, undefined)).toBeNull();
    expect(pickSource(options, '-42')).toBe('-42');
    expect(pickSource(options, 'nope')).toBeNull();
  });
});

describe('sameSeries', () => {
  const f = (title: string, more: Partial<SeriesFacts> = {}): SeriesFacts => ({
    title, author: '', artist: '', description: '', tracks: [], ...more,
  });

  it('matches titles that differ only in width, case or punctuation', () => {
    expect(similarity('ＯＮＥ ＰＩＥＣＥ!', 'One Piece')).toBe(1);
    expect(sameSeries(f('Solo Leveling'), f('Solo Leveling (Official)'))).toMatch(/close/);
  });

  it('matches close spellings of a romanized title', () => {
    expect(sameSeries(f('Kaguya-sama wa Kokurasetai'), f('Kaguya-sama wa Kokurasetai?'))).not.toBeNull();
    expect(sameSeries(f('Shingeki no Kyojin'), f('Shingeki no Kyoujin'))).toMatch(/similar/);
  });

  it('matches across scripts through a shared tracker, tracker titles or the description', () => {
    expect(sameSeries(f('나 혼자만 레벨업', { tracks: [{ trackerId: 2, remoteId: '105398', title: '' }] }), f('Solo Leveling', { tracks: [{ trackerId: 2, remoteId: '105398', title: '' }] }))).toMatch(/AniList/);
    expect(sameSeries(f('進撃の巨人', { tracks: [{ trackerId: 1, remoteId: '23390', title: 'Shingeki no Kyojin' }] }), f('Shingeki no Kyojin'))).toMatch(/known as/);
    expect(sameSeries(f('Solo Leveling'), f('나 혼자만 레벨업', { description: 'Associated names: Solo Leveling, Only I Level Up' }))).toMatch(/description/);
  });

  it('matches on a shared author', () => {
    expect(sameSeries(f('チェンソーマン', { author: '藤本タツキ' }), f('Chainsaw Man', { author: 'Tatsuki Fujimoto, 藤本タツキ' }))).toMatch(/author/);
  });

  it("doesn't match unrelated series", () => {
    expect(sameSeries(f('Totally Different'), f('Old Ongoing'))).toBeNull();
    expect(sameSeries(f('進撃の巨人'), f('Solo Leveling'))).toBeNull();
    expect(similarity('Tower of God', 'God of High School')).toBeLessThan(SIMILAR);
  });
});
