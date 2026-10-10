import { memo, useEffect, useState } from 'react';
import { ArrowRightLeft, Eye, EyeOff, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { useIgnore, useRecheck, useRemove, type SeriesView } from '../api';
import { Cover, HEALTH, HealthBadge, relTime } from './ui';

export function MigrateLink({ series, compact = false }: { series: SeriesView; compact?: boolean }) {
  return (
    <a
      href={series.suwayomiUrl}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      title="Opens this series in Suwayomi. Tap Migrate (the ⇄ button at the top) to move it to another source."
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-violet-600 font-medium text-white shadow-sm shadow-violet-900/20 hover:bg-violet-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
        compact ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm'
      }`}
    >
      <ArrowRightLeft className="size-3.5" />
      Migrate in Suwayomi
    </a>
  );
}

/** Removes a series from the Suwayomi library. The first tap arms it, the second one removes. */
export function RemoveButton({ series, compact = false }: { series: SeriesView; compact?: boolean }) {
  const remove = useRemove();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const label = remove.isPending ? 'Removing…' : armed ? (compact ? 'Remove?' : 'Tap again to remove') : 'Remove from library';
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!armed) return setArmed(true);
          setArmed(false);
          remove.mutate(series.mangaId);
        }}
        disabled={remove.isPending}
        title="Removes this series from your Suwayomi library. Suwayomi keeps its downloads and read progress, so you can add it back later."
        aria-label={label}
        className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-60 ${
          compact ? 'h-8 text-xs' : 'h-9 text-sm'
        } ${
          armed
            ? 'bg-rose-600 px-2.5 text-white hover:bg-rose-500'
            : compact
              ? 'w-8 text-zinc-500 hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-400'
              : 'px-3.5 text-rose-700 ring-1 ring-inset ring-rose-200 hover:bg-rose-50 dark:text-rose-300 dark:ring-rose-500/30 dark:hover:bg-rose-500/10'
        }`}
      >
        {remove.isPending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className={compact ? 'size-4' : 'size-3.5'} />}
        {(armed || !compact || remove.isPending) && label}
      </button>
      {remove.isError && <span className="mt-1 text-xs text-rose-600 dark:text-rose-400">{remove.error.message}</span>}
    </span>
  );
}

/** Memoized: the list re-renders on every live update, but a card only when its own series changes. */
export const SeriesCard = memo(function SeriesCard({ series, onOpen }: { series: SeriesView; onOpen: (mangaId: number) => void }) {
  const recheck = useRecheck();
  const ignore = useIgnore();
  const top = series.findings.find((f) => f.severity !== 'info') ?? series.findings[0];
  const health = series.resolvedAt ? null : series.health;
  const accent = HEALTH[series.underlyingHealth].dot;
  const ignored = series.health === 'ignored';
  const pending = recheck.isPending && recheck.variables === series.mangaId;
  const latestGroup = series.scanlators?.groups[0];

  return (
    <article
      onClick={() => onOpen(series.mangaId)}
      className="group relative flex cursor-pointer gap-3.5 overflow-hidden rounded-2xl border border-zinc-200 bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-xl hover:shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:shadow-black/30"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${accent} ${ignored || series.resolvedAt ? 'opacity-30' : ''}`} aria-hidden />
      <Cover src={series.thumbnailUrl} title={series.title} className="ml-1 aspect-[2/3] w-[4.5rem] shrink-0 rounded-lg" />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start gap-2">
          <h3 className="line-clamp-2 flex-1 font-semibold leading-snug tracking-tight">{series.title}</h3>
          {health ? <HealthBadge health={health} /> : <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">Resolved</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
          {series.sourceIconUrl && (
            <img src={series.sourceIconUrl} alt="" className="size-3.5 rounded-sm" onError={(e) => (e.currentTarget.style.display = 'none')} />
          )}
          <span className="truncate">{series.sourceName}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">checked {relTime(series.lastCheckedAt)}</span>
        </div>

        {top ? (
          <p className="mt-2 line-clamp-2 text-sm text-zinc-700 dark:text-zinc-300">{top.message}</p>
        ) : (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            {series.lastCheckedAt ? 'No problems found.' : 'Not checked yet.'}
          </p>
        )}
        {series.findings.length > 1 && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">+{series.findings.length - 1} more</p>
        )}
        {latestGroup && !series.resolvedAt && (
          <p className="mt-1 truncate text-xs text-violet-700 dark:text-violet-300" title="Latest release on MangaUpdates">
            Now scanlated by {latestGroup.name} ({latestGroup.chapter})
          </p>
        )}

        <div className="mt-auto flex items-center gap-1 pt-3">
          {!series.resolvedAt && (series.underlyingHealth === 'broken' || series.underlyingHealth === 'warning') && (
            <MigrateLink series={series} compact />
          )}
          {!series.resolvedAt && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  recheck.mutate(series.mangaId);
                }}
                disabled={pending}
                title="Recheck now"
                aria-label="Recheck now"
                className="ml-auto grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  ignore.mutate({ mangaId: series.mangaId, days: ignored ? 0 : null });
                }}
                title={ignored ? 'Stop ignoring' : 'Ignore this series'}
                aria-label={ignored ? 'Stop ignoring' : 'Ignore this series'}
                className="grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {ignored ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
              <RemoveButton series={series} compact />
            </>
          )}
        </div>
        {recheck.isError && recheck.variables === series.mangaId && (
          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{recheck.error.message}</p>
        )}
      </div>
    </article>
  );
});
