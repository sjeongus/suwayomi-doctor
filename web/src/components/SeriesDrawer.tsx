import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Eye, EyeOff, Globe, Loader2, RotateCw, Search, X } from 'lucide-react';
import { useHistory, useIgnore, useRecheck, useScanlatorLookup, type SeriesView } from '../api';
import { MigrateLink, RemoveButton } from './SeriesCard';
import { Button, Cover, formatDate, HEALTH, HealthBadge, relTime } from './ui';

const ERROR_LABEL: Record<string, string> = {
  not_found: 'Not found',
  blocked: 'Blocked',
  source_missing: 'Source missing',
  error: 'Error',
};

const STATUS_LABEL: Record<string, string> = {
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
  LICENSED: 'Licensed',
  PUBLISHING_FINISHED: 'Publishing finished',
  CANCELLED: 'Cancelled',
  ON_HIATUS: 'On hiatus',
  UNKNOWN: 'Unknown status',
};

export function SeriesDrawer({ series, onClose }: { series: SeriesView | null; onClose: () => void }) {
  const open = series !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-40 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-zinc-950/40 backdrop-blur-[2px] transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={series?.title}
        className={`scroll-thin absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l border-zinc-200 bg-white shadow-2xl transition-transform duration-300 dark:border-zinc-800 dark:bg-zinc-900 ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {series && <DrawerBody series={series} onClose={onClose} />}
      </aside>
    </div>
  );
}

function DrawerBody({ series, onClose }: { series: SeriesView; onClose: () => void }) {
  const history = useHistory(series.mangaId);
  const recheck = useRecheck();
  const ignore = useIgnore();
  const [copied, setCopied] = useState(false);
  const ignored = series.health === 'ignored';

  return (
    <>
      <div className="relative">
        <div className="absolute inset-0 overflow-hidden">
          <img src={series.thumbnailUrl} alt="" className="size-full scale-110 object-cover opacity-25 blur-2xl" onError={(e) => (e.currentTarget.style.display = 'none')} />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-white dark:to-zinc-900" />
        </div>
        <div className="relative flex gap-4 p-5 pt-6">
          <Cover src={series.thumbnailUrl} title={series.title} className="aspect-[2/3] w-24 shrink-0 rounded-xl shadow-lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold leading-snug tracking-tight">{series.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {series.sourceName}
              {series.extensionName && series.extensionName !== series.sourceName ? ` · ${series.extensionName}` : ''}
            </p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {STATUS_LABEL[series.status] ?? series.status} · {series.chapterCount ?? 0} chapters
              {series.latestChapterAt ? ` · latest ${relTime(series.latestChapterAt)}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {series.resolvedAt ? (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  Left your library {relTime(series.resolvedAt)}
                </span>
              ) : (
                <HealthBadge health={series.health} size="md" />
              )}
              {ignored && <HealthBadge health={series.underlyingHealth} size="md" />}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="space-y-6 px-5 pb-8">
        {!series.resolvedAt && (
          <div className="flex flex-wrap gap-2">
            <MigrateLink series={series} />
            <Button onClick={() => recheck.mutate(series.mangaId)} disabled={recheck.isPending}>
              {recheck.isPending ? <Loader2 className="size-4 animate-spin" /> : <RotateCw className="size-4" />}
              Recheck now
            </Button>
            <RemoveButton series={series} />
          </div>
        )}
        {recheck.isError && <p className="text-sm text-rose-600 dark:text-rose-400">{recheck.error.message}</p>}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">What Doctor found</h3>
          {series.findings.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {series.lastCheckedAt ? 'Nothing wrong. The source answered normally on the last check.' : 'Not checked yet. Run a scan or recheck this series.'}
            </p>
          ) : (
            <ul className="space-y-2">
              {series.findings.map((f) => {
                const h = HEALTH[f.severity === 'info' ? 'unchecked' : f.severity];
                const Icon = h.icon;
                return (
                  <li key={f.code} className={`rounded-xl p-3 ring-1 ring-inset ${h.bg} ${h.ring}`}>
                    <div className="flex gap-2">
                      <Icon className={`mt-0.5 size-4 shrink-0 ${h.text}`} />
                      <div>
                        <p className="text-sm font-medium">{f.message}</p>
                        {f.hint && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{f.hint}</p>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {!series.resolvedAt && <ScanlatorSection series={series} />}

        {series.lastError && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Last error from Suwayomi</h3>
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                onClick={() => {
                  void navigator.clipboard?.writeText(series.lastError ?? '');
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-zinc-100 p-3 font-mono text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
              {series.lastError}
            </pre>
          </section>
        )}

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Check history</h3>
          {history.isLoading ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : !history.data?.length ? (
            <p className="text-sm text-zinc-500">No checks yet.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-zinc-200 pl-4 dark:border-zinc-800">
              {history.data.map((c, i) => (
                <li key={i} className="relative">
                  <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-white dark:ring-zinc-900 ${HEALTH[c.health].dot}`} />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {c.ok ? `OK · ${c.chapterCount ?? 0} chapters` : ERROR_LABEL[c.errorKind ?? 'error'] ?? 'Error'}
                    </span>
                    <time className="shrink-0 text-xs text-zinc-500" title={formatDate(c.at)}>
                      {relTime(c.at)}
                    </time>
                  </div>
                  {!c.ok && c.error && <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">{c.error}</p>}
                  {c.scanId === null && <p className="text-xs text-zinc-400">Manual recheck</p>}
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="space-y-1.5 text-sm">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Links</h3>
          <a href={series.suwayomiUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-violet-700 hover:underline dark:text-violet-300">
            <ExternalLink className="size-4" /> Open in Suwayomi
          </a>
          {series.realUrl && (
            <a href={series.realUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-violet-700 hover:underline dark:text-violet-300">
              <Globe className="size-4" /> Open on the source site
            </a>
          )}
          {series.categories.length > 0 && (
            <p className="pt-1 text-zinc-500 dark:text-zinc-400">Categories: {series.categories.join(', ')}</p>
          )}
          {series.firstUnhealthyAt && !series.resolvedAt && (
            <p className="text-zinc-500 dark:text-zinc-400">Unhealthy since {formatDate(series.firstUnhealthyAt)}</p>
          )}
        </section>

        {!series.resolvedAt && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Ignore</h3>
            {ignored ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {series.ignoredUntil && series.ignoredUntil < 32503680000 ? `Ignored until ${formatDate(series.ignoredUntil)}` : 'Ignored for good'}
                </p>
                <Button size="sm" onClick={() => ignore.mutate({ mangaId: series.mangaId, days: 0 })}>
                  <Eye className="size-3.5" /> Stop ignoring
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => ignore.mutate({ mangaId: series.mangaId, days: 30 })}>
                  <EyeOff className="size-3.5" /> For 30 days
                </Button>
                <Button size="sm" onClick={() => ignore.mutate({ mangaId: series.mangaId, days: null })}>
                  <EyeOff className="size-3.5" /> For good
                </Button>
              </div>
            )}
            <p className="mt-2 text-xs text-zinc-500">Ignored series are skipped by scans and hidden from "Needs attention".</p>
          </section>
        )}
      </div>
    </>
  );
}

/** Who scanlates the series now, per MangaUpdates: sites worth adding an extension for, then migrating to. */
/** A hint older than this is looked up again when the panel opens. */
const HINT_MAX_AGE_SEC = 7 * 24 * 3600;
/** Series already looked up automatically this visit, so reopening the panel doesn't ask again. */
const autoLookedUp = new Set<number>();

function ScanlatorSection({ series }: { series: SeriesView }) {
  const lookup = useScanlatorLookup();
  const hint = series.scanlators;
  const pending = lookup.isPending;

  // Look up automatically when there's no hint yet, it's stale, or the last try failed.
  const { mangaId } = series;
  const due = !hint || hint.error !== null || Date.now() / 1000 - hint.lookedUpAt > HINT_MAX_AGE_SEC;
  const { mutate } = lookup;
  useEffect(() => {
    if (!due || autoLookedUp.has(mangaId)) return;
    autoLookedUp.add(mangaId);
    mutate(mangaId);
  }, [due, mangaId, mutate]);

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Where to migrate</h3>
        <Button size="sm" variant="ghost" onClick={() => lookup.mutate(series.mangaId)} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
          {pending ? 'Looking up…' : hint ? 'Refresh' : 'Look up on MangaUpdates'}
        </Button>
      </div>
      {lookup.isError && <p className="mb-2 text-sm text-rose-600 dark:text-rose-400">{lookup.error.message}</p>}
      {!hint ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {pending
            ? 'Looking up who scanlates this series on MangaUpdates…'
            : 'Finds which group released the latest chapters on MangaUpdates, so you know which extension to add before migrating.'}
        </p>
      ) : hint.error ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{hint.error}</p>
      ) : !hint.series ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          MangaUpdates has no series that matches this title. Adding a MangaUpdates tracker to the series in Suwayomi links it exactly.
        </p>
      ) : (
        <>
          {hint.groups.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">MangaUpdates lists no releases for this series.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-xl ring-1 ring-zinc-200 dark:divide-zinc-800 dark:ring-zinc-800">
              {hint.groups.map((g, i) => (
                <li key={g.name} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {g.name}
                      {i === 0 && <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Latest</span>}
                    </p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {g.chapter} · {g.releasedOn}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-3 text-xs">
                    {g.site && (
                      <a href={g.site} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-violet-700 hover:underline dark:text-violet-300">
                        <Globe className="size-3.5" /> Site
                      </a>
                    )}
                    {g.muUrl && (
                      <a href={g.muUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-zinc-500 hover:underline dark:text-zinc-400">
                        <ExternalLink className="size-3.5" /> Group
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            From{' '}
            <a href={hint.series.url} target="_blank" rel="noreferrer" className="underline">
              {hint.series.title}
            </a>{' '}
            on MangaUpdates ({hint.series.matchedBy.replace(/\.$/, '').toLowerCase()}), {relTime(hint.lookedUpAt)}. Add an extension for one of
            these sites in Suwayomi, then migrate.
          </p>
        </>
      )}
    </section>
  );
}
