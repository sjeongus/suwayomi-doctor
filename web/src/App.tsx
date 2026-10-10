import { lazy, Suspense, useCallback, useDeferredValue, useMemo, useState } from 'react';
import { CheckCircle2, Layers, Search, X } from 'lucide-react';
import { useLiveUpdates, useSeries, useSources, useSummary, type Health, type SeriesView } from './api';
import { Header } from './components/Header';
import { SourceBanners, Tiles, type Filter } from './components/Overview';
import { SeriesDrawer } from './components/SeriesDrawer';
import { SeriesGrid } from './components/SeriesGrid';

// Dialogs load on first open, keeping them out of the initial bundle.
const MihonDialog = lazy(() => import('./components/MihonDialog').then((m) => ({ default: m.MihonDialog })));
const SettingsDialog = lazy(() => import('./components/SettingsDialog').then((m) => ({ default: m.SettingsDialog })));

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'attention', label: 'Needs attention' },
  { id: 'broken', label: 'Broken' },
  { id: 'warning', label: 'Warning' },
  { id: 'healthy', label: 'Healthy' },
  { id: 'unchecked', label: 'Unchecked' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'all', label: 'All' },
];

const RANK: Record<Health, number> = { broken: 0, warning: 1, unchecked: 2, healthy: 3, ignored: 4 };
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function matches(s: SeriesView, filter: Filter): boolean {
  if (filter === 'resolved') return s.resolvedAt !== null;
  if (s.resolvedAt !== null) return false;
  if (filter === 'all') return true;
  if (filter === 'attention') return s.health === 'broken' || s.health === 'warning';
  return s.health === filter;
}

export function App() {
  useLiveUpdates();
  const summary = useSummary();
  const series = useSeries();
  const sources = useSources();

  const [filter, setFilter] = useState<Filter>('attention');
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState<string>('');
  const [grouped, setGrouped] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mihonOpen, setMihonOpen] = useState(false);

  const all = useMemo(() => series.data ?? [], [series.data]);
  // Typing stays responsive on big libraries: filtering catches up a frame later.
  const deferredQuery = useDeferredValue(query);
  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return all
      .filter(
        (s) =>
          matches(s, filter) &&
          (!sourceId || s.sourceId === sourceId) &&
          (!q || s.title.toLowerCase().includes(q) || s.sourceName.toLowerCase().includes(q)),
      )
      .sort((a, b) => RANK[a.health] - RANK[b.health] || collator.compare(a.title, b.title));
  }, [all, filter, sourceId, deferredQuery]);

  const groups = useMemo((): [string, SeriesView[]][] => {
    if (!grouped) return [['', visible]];
    const m = new Map<string, SeriesView[]>();
    for (const s of visible) {
      const list = m.get(s.sourceName);
      if (list) list.push(s);
      else m.set(s.sourceName, [s]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [grouped, visible]);

  const open = useMemo(() => (openId === null ? null : (all.find((s) => s.mangaId === openId) ?? null)), [all, openId]);
  const close = useCallback(() => setOpenId(null), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openMihon = useCallback(() => setMihonOpen(true), []);
  const counts = summary.data?.counts;
  const ignoredCount = counts?.ignored ?? 0;
  const resolvedCount = summary.data?.resolved ?? 0;

  const pickSource = (id: string) => {
    setSourceId(id);
    setFilter('all');
  };

  return (
    <div className="min-h-dvh">
      <Header summary={summary.data} onOpenSettings={openSettings} onOpenMihon={openMihon} />

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <Tiles summary={summary.data} filter={filter} onFilter={setFilter} />
        <SourceBanners sources={sources.data} migrateUrl={summary.data?.migrateBrowseUrl} onPickSource={pickSource} />

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:pb-0">
            {FILTERS.map((f) => {
              const n =
                f.id === 'attention'
                  ? (counts?.broken ?? 0) + (counts?.warning ?? 0)
                  : f.id === 'resolved'
                    ? resolvedCount
                    : f.id === 'all'
                      ? null
                      : counts?.[f.id];
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
                    filter === f.id
                      ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                      : 'text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800'
                  }`}
                >
                  {f.label}
                  {n != null && n > 0 && <span className="tabular-nums opacity-60">{n}</span>}
                </button>
              );
            })}
          </div>

          <div className="flex flex-1 gap-2 lg:justify-end">
            <div className="relative min-w-0 flex-1 lg:max-w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles"
                className="h-9 w-full rounded-lg border-0 bg-white pl-8 pr-3 text-sm ring-1 ring-inset ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-violet-500 focus:outline-none dark:bg-zinc-900 dark:ring-zinc-800"
              />
            </div>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="h-9 max-w-44 rounded-lg border-0 bg-white px-2.5 text-sm ring-1 ring-inset ring-zinc-200 focus:ring-2 focus:ring-violet-500 focus:outline-none dark:bg-zinc-900 dark:ring-zinc-800"
              aria-label="Filter by source"
            >
              <option value="">All sources</option>
              {sources.data?.map((s) => (
                <option key={s.sourceId} value={s.sourceId}>
                  {s.name} ({s.seriesCount})
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setGrouped((g) => !g)}
              aria-pressed={grouped}
              title="Group by source"
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ring-1 ring-inset transition-colors ${
                grouped
                  ? 'bg-violet-600 text-white ring-violet-600'
                  : 'bg-white text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800'
              }`}
            >
              <Layers className="size-4" />
            </button>
          </div>
        </div>

        {sourceId && (
          <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            Showing {sources.data?.find((s) => s.sourceId === sourceId)?.name ?? 'one source'}
            <button type="button" onClick={() => setSourceId('')} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-800">
              <X className="size-3.5" /> Clear
            </button>
          </div>
        )}

        {series.isLoading ? (
          <SkeletonGrid />
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} hasSeries={all.length > 0} filtered={!!query || !!sourceId} />
        ) : (
          <SeriesGrid groups={groups} grouped={grouped} onOpen={setOpenId} />
        )}

        {(ignoredCount > 0 || resolvedCount > 0) && filter === 'attention' && (
          <p className="text-center text-xs text-zinc-500">
            {ignoredCount > 0 && `${ignoredCount} ignored`}
            {ignoredCount > 0 && resolvedCount > 0 && ' · '}
            {resolvedCount > 0 && `${resolvedCount} resolved (left your library)`}
          </p>
        )}
      </main>

      <SeriesDrawer series={open} onClose={close} />
      <Suspense fallback={null}>
        {mihonOpen && <MihonDialog open onClose={() => setMihonOpen(false)} />}
        {settingsOpen && <SettingsDialog open onClose={() => setSettingsOpen(false)} summary={summary.data} />}
      </Suspense>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex h-[8.5rem] animate-pulse gap-3.5 rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="ml-1 w-[4.5rem] rounded-lg bg-zinc-200 dark:bg-zinc-800" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-2/3 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-1/3 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-3 w-5/6 rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filter, hasSeries, filtered }: { filter: Filter; hasSeries: boolean; filtered: boolean }) {
  if (!hasSeries) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
        <p className="font-medium">No library series yet</p>
        <p className="mt-1 text-sm text-zinc-500">Doctor mirrors your Suwayomi library. Once it's reachable, series show up here.</p>
      </div>
    );
  }
  if (filter === 'attention' && !filtered) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-12 text-center dark:border-emerald-500/20 dark:bg-emerald-500/5">
        <CheckCircle2 className="mx-auto size-10 text-emerald-500" />
        <p className="mt-3 font-medium">Nothing needs attention</p>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Every checked series answered normally on its last scan.</p>
      </div>
    );
  }
  return <p className="py-12 text-center text-sm text-zinc-500">No series match these filters.</p>;
}
