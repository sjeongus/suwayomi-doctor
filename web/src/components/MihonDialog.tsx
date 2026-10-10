import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronRight, Copy, FileUp, Loader2, Smartphone, TriangleAlert, X } from 'lucide-react';
import { checkMihonBackup, type MihonCheckResult, type MihonEntry } from '../api';
import { Button, relTime } from './ui';

export function MihonDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<MihonCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [useAniList, setUseAniList] = useState(true);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const check = async (f: File, sourceId?: string) => {
    setFile(f);
    setBusy(true);
    setError(null);
    try {
      setResult(await checkMihonBackup(f, sourceId, useAniList));
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const orphans = result ? [...result.removed, ...result.deleted].sort((a, b) => a.title.localeCompare(b.title)) : [];
  const copyList = () => {
    void navigator.clipboard?.writeText(orphans.map((o) => o.title).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Clean up Mihon"
        className="scroll-thin relative max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Smartphone className="size-5 text-violet-500" /> Clean up Mihon
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Finds series in Mihon's library, added through the Suwayomi extension, that are no longer in your Suwayomi library. Every
              other source in Mihon is ignored.
            </p>
          </div>
          <button type="button" onClick={onClose} className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
          <li>
            In Mihon, go to <b>More → Settings → Data and storage → Create backup</b>.
          </li>
          <li>Get the .tachibk file onto this device and choose it below.</li>
        </ol>

        <input
          ref={input}
          type="file"
          accept=".tachibk,.gz,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void check(f);
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
            {file ? 'Choose another backup' : 'Choose Mihon backup'}
          </Button>
          {file && <span className="truncate text-sm text-zinc-500">{file.name}</span>}
        </div>
        <label className="mt-3 flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={useAniList}
            onChange={(e) => setUseAniList(e.target.checked)}
            disabled={busy}
            className="mt-0.5 size-4 accent-violet-600"
          />
          <span>
            Look up titles that don't match on AniList
            <span className="block text-xs text-zinc-500">
              Catches the same series under another language's title. Sends only those titles to AniList; no account needed.
            </span>
          </span>
        </label>
        {busy && useAniList && <p className="mt-2 text-xs text-zinc-500">Checking… AniList lookups can take a little while.</p>}
        <p className="mt-2 text-xs text-zinc-500">Doctor reads the backup in memory and doesn't keep it. Nothing in Mihon or Suwayomi is changed.</p>

        {error && <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}

        {result && file && (
          <div className="mt-6 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-600 dark:text-zinc-400">Source checked</span>
              <select
                value={result.sourceId ?? ''}
                onChange={(e) => e.target.value && void check(file, e.target.value)}
                disabled={busy}
                className="h-8 max-w-full rounded-lg border-0 bg-white px-2 text-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-violet-500 focus:outline-none dark:bg-zinc-950 dark:ring-zinc-700"
              >
                {result.sourceId === null && <option value="">Pick your Suwayomi source…</option>}
                {result.sources.map((s) => (
                  <option key={s.sourceId} value={s.sourceId}>
                    {s.name} ({s.count})
                  </option>
                ))}
              </select>
            </div>

            {result.sourceId === null ? (
              <Notice>
                No source in this backup is named Suwayomi or Tachidesk. If your Suwayomi extension has another name, pick it above.
              </Notice>
            ) : (
              <>
                <p className="text-sm">
                  Checked <b>{result.checked}</b> series from this source. <b>{result.stillInLibrary}</b> are still in your Suwayomi
                  library.
                  {orphans.length === 0 && result.unsure.length === 0 && ' Nothing to clean up.'}
                </p>
                {result.looksLikeOtherServer && (
                  <Notice>
                    Most of these series don't match your server. If this backup's Suwayomi extension points at a different server,
                    these results don't apply to it, so don't remove anything based on them.
                  </Notice>
                )}

                {result.anilist?.error && <Notice>{result.anilist.error} Those titles are under "Check these by hand".</Notice>}
                {result.anilist && !result.anilist.error && (
                  <p className="text-xs text-zinc-500">
                    Looked up {result.anilist.looked} unmatched {result.anilist.looked === 1 ? 'title' : 'titles'} on AniList and matched{' '}
                    {result.anilist.matched}.
                  </p>
                )}

                {orphans.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-zinc-500">
                      In Mihon, search your library for each title, long-press it, tap the trash icon and choose to remove it from the
                      library.
                    </p>
                    <Button size="sm" onClick={copyList}>
                      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      {copied ? 'Copied' : `Copy ${orphans.length} titles`}
                    </Button>
                  </div>
                )}

                <EntrySection
                  title="Left your Suwayomi library"
                  entries={result.removed}
                  describe={(e) =>
                    [
                      e.resolvedAt ? `Removed or migrated ${relTime(e.resolvedAt)}.` : 'Still on your server, but not in your library.',
                      e.matchedBy && `On your server as "${e.serverTitle}". ${e.matchedBy}`,
                    ]
                      .filter(Boolean)
                      .join(' ')
                  }
                />
                <EntrySection
                  title="Gone from your server"
                  entries={result.deleted}
                  describe={() => 'Your server has no series with this id any more.'}
                />
                <EntrySection
                  title="Check these by hand"
                  hint="Doctor can't match these to your server, so they're not counted as orphans or copied with the titles above."
                  entries={result.unsure}
                  collapsible
                  describe={(e) =>
                    e.mangaId === null
                      ? "Doctor couldn't read a Suwayomi id from this entry's link."
                      : `Your server has "${e.serverTitle}" under this id, and Doctor found nothing linking the two (no shared tracker, similar title, author, or AniList entry).`
                  }
                />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EntrySection({
  title,
  hint,
  entries,
  describe,
  collapsible = false,
}: {
  title: string;
  hint?: string;
  entries: MihonEntry[];
  describe: (e: MihonEntry) => string;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible);
  if (entries.length === 0) return null;
  const heading = (
    <>
      {title} <span className="font-normal text-zinc-500">{entries.length}</span>
    </>
  );

  return (
    <section>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          aria-expanded={expanded}
          className="mb-2 flex items-center gap-1 text-left text-sm font-semibold"
        >
          <ChevronRight className={`size-4 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          {heading}
        </button>
      ) : (
        <h3 className="mb-2 text-sm font-semibold">{heading}</h3>
      )}
      {hint && <p className="mb-2 text-xs text-zinc-500">{hint}</p>}
      {expanded && (
        <ul className="divide-y divide-zinc-200 rounded-xl ring-1 ring-zinc-200 dark:divide-zinc-800 dark:ring-zinc-800">
          {entries.map((e, i) => (
            <li key={`${e.mangaId}-${i}`} className="px-3 py-2">
              <div className="text-sm font-medium">{e.title}</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{describe(e)}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
