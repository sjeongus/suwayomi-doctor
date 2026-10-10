import { ArrowRightLeft, ServerCrash, PackageX, WifiOff } from 'lucide-react';
import type { Health, SourceView, Summary } from '../api';
import { HEALTH } from './ui';

export type Filter = 'attention' | Health | 'resolved' | 'all';

const TILE_ORDER: Exclude<Health, 'ignored'>[] = ['broken', 'warning', 'healthy', 'unchecked'];
const TILE_HINT: Record<Exclude<Health, 'ignored'>, string> = {
  broken: 'Migrate or fix the source',
  warning: 'Worth a look',
  healthy: 'Source is working',
  unchecked: 'Waiting for a scan',
};

export function Tiles({ summary, filter, onFilter }: { summary: Summary | undefined; filter: Filter; onFilter: (f: Filter) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {TILE_ORDER.map((h) => {
        const meta = HEALTH[h];
        const Icon = meta.icon;
        const active = filter === h;
        const count = summary?.counts[h];
        return (
          <button
            key={h}
            type="button"
            onClick={() => onFilter(active ? 'attention' : h)}
            className={`group rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-violet-500 ${
              active
                ? `border-transparent ring-2 ${meta.ring} ${meta.bg}`
                : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
            }`}
            aria-pressed={active}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{meta.label}</span>
              <span className={`grid size-8 place-items-center rounded-lg ${meta.bg} ${meta.text}`}>
                <Icon className="size-4" />
              </span>
            </div>
            <div className={`mt-2 text-3xl font-semibold tabular-nums tracking-tight ${count ? meta.text : ''}`}>
              {count ?? '–'}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{TILE_HINT[h]}</div>
          </button>
        );
      })}
    </div>
  );
}

/** Banners for sources where the problem is the whole source, not one series. */
export function SourceBanners({
  sources,
  migrateUrl,
  onPickSource,
}: {
  sources: SourceView[] | undefined;
  migrateUrl: string | undefined;
  onPickSource: (sourceId: string) => void;
}) {
  const problems = (sources ?? [])
    .map((s) => {
      if (s.missing) return { s, icon: PackageX, title: `${s.name} can't be loaded`, body: 'The extension is uninstalled or no longer has this source.' };
      if (s.obsolete) return { s, icon: PackageX, title: `${s.name} is no longer supported`, body: 'Its extension was removed from your extension repo.' };
      if (s.outageStreak > 0)
        return {
          s,
          icon: s.outageStreak > 1 ? ServerCrash : WifiOff,
          title: `${s.name} looks down`,
          body:
            s.outageStreak > 1
              ? `Most of its series have failed for ${s.outageStreak} scans in a row.`
              : 'Most of its series failed in the last scan. It may be a temporary outage.',
        };
      return null;
    })
    .filter((p) => p !== null);

  if (problems.length === 0) return null;
  return (
    <div className="space-y-2">
      {problems.map(({ s, icon: Icon, title, body }) => (
        <div
          key={s.sourceId}
          className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-gradient-to-r from-rose-50 to-white p-4 sm:flex-row sm:items-center dark:border-rose-500/25 dark:from-rose-500/10 dark:to-zinc-900"
        >
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
              <Icon className="size-4.5" />
            </span>
            <div className="min-w-0">
              <div className="font-medium">{title}</div>
              <div className="text-sm text-zinc-600 dark:text-zinc-400">
                {body} {s.seriesCount} {s.seriesCount === 1 ? 'series is' : 'series are'} on this source.
              </div>
            </div>
          </div>
          <div className="flex shrink-0 gap-2 sm:ml-auto">
            <button
              type="button"
              onClick={() => onPickSource(s.sourceId)}
              className="h-8 rounded-lg px-3 text-xs font-medium text-zinc-700 ring-1 ring-inset ring-zinc-300 hover:bg-white dark:text-zinc-200 dark:ring-zinc-700 dark:hover:bg-zinc-800"
            >
              Show series
            </button>
            {migrateUrl && (
              <a
                href={migrateUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-medium text-white hover:bg-rose-500"
                title="Opens Browse → Migrate in Suwayomi. Pick this source there to migrate its series in bulk."
              >
                <ArrowRightLeft className="size-3.5" /> Bulk migrate in Suwayomi
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
