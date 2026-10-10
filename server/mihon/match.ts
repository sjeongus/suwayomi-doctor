// Decides whether a Mihon entry and the Suwayomi series with the same id are the same series,
// when their titles don't simply agree (a renamed series, or a title in another language).

export interface SeriesFacts {
  title: string;
  author: string;
  artist: string;
  description: string;
  /** Tracker entries: Mihon and Suwayomi share tracker ids (1 MyAnimeList, 2 AniList, ...). */
  tracks: { trackerId: number; remoteId: string; title: string }[];
}

const TRACKERS: Record<number, string> = { 1: 'MyAnimeList', 2: 'AniList', 3: 'Kitsu', 4: 'Shikimori', 5: 'Bangumi', 7: 'MangaUpdates' };

/** Similarity at or above this counts as the same title. */
export const SIMILAR = 0.75;
/** Alternative titles shorter than this are too likely to appear in a description by chance. */
const MIN_ALT_TITLE = 4;

/** Folds width, case, punctuation and spacing, so "ＯＮＥ ＰＩＥＣＥ!" and "One Piece" compare equal. Keeps CJK. */
export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Dice coefficient over character pairs: 1 for identical, 0 for nothing shared. Works for any script. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const bx = bigrams(x);
  const by = bigrams(y);
  let shared = 0;
  for (const [g, n] of bx) shared += Math.min(n, by.get(g) ?? 0);
  return (2 * shared) / (x.length - 1 + (y.length - 1));
}

const names = (s: SeriesFacts) => [s.title, ...s.tracks.map((t) => t.title)].filter((n) => normalize(n).length > 0);

function people(s: SeriesFacts): Set<string> {
  return new Set(
    `${s.author},${s.artist}`
      .split(/[,;&/、・]|\s+x\s+/i)
      .map(normalize)
      .filter((p) => p.length >= 2),
  );
}

/** The first piece of evidence that both describe the same series, in words, or null when there's none. */
export function sameSeries(a: SeriesFacts, b: SeriesFacts): string | null {
  for (const ta of a.tracks) {
    if (ta.remoteId !== '0' && b.tracks.some((tb) => tb.trackerId === ta.trackerId && tb.remoteId === ta.remoteId)) {
      return `Both are linked to the same ${TRACKERS[ta.trackerId] ?? 'tracker'} entry.`;
    }
  }

  const an = names(a);
  const bn = names(b);
  let best = 0;
  for (const x of an) {
    for (const y of bn) {
      const nx = normalize(x);
      const ny = normalize(y);
      if (nx === ny) return x === a.title && y === b.title ? 'Same title.' : `Both are known as "${y}".`;
      if (nx.length >= MIN_ALT_TITLE && ny.length >= MIN_ALT_TITLE && (nx.includes(ny) || ny.includes(nx))) {
        return `"${x}" and "${y}" are close.`;
      }
      best = Math.max(best, similarity(x, y));
    }
  }
  if (best >= SIMILAR) return `Titles are ${Math.round(best * 100)}% similar.`;

  const da = normalize(a.description);
  const db = normalize(b.description);
  const inDesc = (n: string, desc: string) => normalize(n).length >= MIN_ALT_TITLE && desc.includes(normalize(n));
  const alt = an.find((n) => inDesc(n, db)) ?? bn.find((n) => inDesc(n, da));
  if (alt) return `"${alt}" is listed as another title in the description.`;

  const pa = people(a);
  const shared = [...people(b)].find((p) => pa.has(p));
  if (shared) return 'Same author or artist.';
  return null;
}
