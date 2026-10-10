import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import { getSeries, listSources } from '../store.js';
import type { GraphQLResult } from '../suwayomi/client.js';
import { SuwayomiClient } from '../suwayomi/client.js';
import { Scanner } from './scanner.js';

type Behaviour = { chapters?: number; error?: string };

/** A stand-in for Suwayomi's GraphQL API with a scripted library. */
class FakeSuwayomi extends SuwayomiClient {
  constructor(
    private readonly library: { id: number; title: string; sourceId: string; sourceMissing?: boolean }[],
    public behaviour: Record<number, Behaviour>,
  ) {
    super({ suwayomiUrl: 'http://fake', authMode: 'none', username: '', password: '' });
  }

  override async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<GraphQLResult<T>> {
    if (query.includes('libraryUpdateStatus')) {
      return { data: { libraryUpdateStatus: { jobsInfo: { isRunning: false } } } as T, errors: [] };
    }
    if (query.includes('query Library')) {
      const nodes = this.library.map((m) => ({
        id: m.id,
        title: m.title,
        status: 'ONGOING',
        realUrl: null,
        sourceId: m.sourceId,
        thumbnailUrl: `/api/v1/manga/${m.id}/thumbnail`,
        initialized: true,
        source: m.sourceMissing
          ? null
          : { id: m.sourceId, displayName: `Source ${m.sourceId}`, iconUrl: '/icon', extension: { pkgName: 'p', name: 'Ext', isInstalled: true, hasUpdate: false, isObsolete: false } },
        chapters: { totalCount: 10 },
        latestUploadedChapter: { uploadDate: String(Date.now()) },
        latestFetchedChapter: { fetchedAt: String(Math.floor(Date.now() / 1000)) },
        categories: { nodes: [] },
      }));
      return { data: { mangas: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } as T, errors: [] };
    }
    if (query.includes('fetchMangaAndChapters')) {
      const b = this.behaviour[variables.id as number] ?? { chapters: 10 };
      const chapters = Array.from({ length: b.chapters ?? 10 }, () => ({ uploadDate: String(Date.now()), fetchedAt: '0' }));
      return {
        data: { fetchMangaAndChapters: { manga: { id: variables.id, status: 'ONGOING', initialized: true }, chapters } } as T,
        errors: b.error ? [{ message: b.error }] : [],
      };
    }
    throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
  }
}

async function scan(scanner: Scanner) {
  scanner.start('manual');
  while (scanner.running) await new Promise((r) => setTimeout(r, 5));
}

function setup(behaviour: Record<number, Behaviour>) {
  const db = openDb(':memory:');
  const client = new FakeSuwayomi(
    [
      { id: 1, title: 'Fine', sourceId: '10' },
      { id: 2, title: 'Removed', sourceId: '10' },
      { id: 3, title: 'Down A', sourceId: '20' },
      { id: 4, title: 'Down B', sourceId: '20' },
      { id: 5, title: 'Down C', sourceId: '20' },
      { id: 6, title: 'Orphan', sourceId: '30', sourceMissing: true },
    ],
    behaviour,
  );
  const config = loadConfig({ DATA_DIR: ':memory:' });
  const settings = { ...config.defaults, delayMs: 0 };
  return { db, client, scanner: new Scanner(db, client, config, () => settings) };
}

describe('Scanner', () => {
  it('scans the library and applies health rules across scans', async () => {
    const { db, scanner } = setup({
      2: { error: 'HTTP error 404' },
      3: { error: 'HTTP error 503' },
      4: { error: 'HTTP error 503' },
      5: { error: 'java.net.SocketTimeoutException: timeout' },
    });

    await scan(scanner);
    expect(getSeries(db, 1)?.health).toBe('healthy');
    expect(getSeries(db, 2)?.health).toBe('warning'); // first 404
    expect(getSeries(db, 6)?.health).toBe('broken'); // source missing, never refreshed
    expect(getSeries(db, 6)?.last_checked_at).toBeNull();
    expect(listSources(db).find((s) => s.source_id === '20')?.outage_streak).toBe(1);
    expect(getSeries(db, 5)?.health).toBe('warning'); // outage holds it at warning

    await scan(scanner);
    expect(getSeries(db, 2)?.health).toBe('broken'); // second 404 in a row
    expect(listSources(db).find((s) => s.source_id === '20')?.outage_streak).toBe(2);
    expect(getSeries(db, 5)?.health).toBe('broken'); // repeated outage + 2 errors
    expect(getSeries(db, 3)?.health).toBe('warning'); // blocked needs 3 in a row
  });

  it('recovers when the source works again', async () => {
    const { db, client, scanner } = setup({ 2: { error: 'HTTP error 404' } });
    await scan(scanner);
    await scan(scanner);
    expect(getSeries(db, 2)?.health).toBe('broken');
    client.behaviour = {};
    await scanner.recheck(2);
    expect(getSeries(db, 2)?.health).toBe('healthy');
    expect(getSeries(db, 2)?.first_unhealthy_at).toBeNull();
  });
});
