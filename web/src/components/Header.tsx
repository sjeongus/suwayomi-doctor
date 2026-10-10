import { useEffect, useState } from 'react';
import { Moon, Play, RefreshCw, Settings as SettingsIcon, Smartphone, Square, Stethoscope, Sun } from 'lucide-react';
import { useCancelScan, useStartScan, useSyncNow, type Summary } from '../api';
import { Button, duration, formatDate, relTime } from './ui';

function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('doctor-theme', next ? 'dark' : 'light');
    } catch {
      /* private mode */
    }
    setDark(next);
  };
  return (
    <Button variant="ghost" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} icon>
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}

export function Header({
  summary,
  onOpenSettings,
  onOpenMihon,
}: {
  summary: Summary | undefined;
  onOpenSettings: () => void;
  onOpenMihon: () => void;
}) {
  const start = useStartScan();
  const cancel = useCancelScan();
  const running = summary?.progress.running ?? false;
  const s = summary?.suwayomi;

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/80 bg-zinc-50/85 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/85">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-900/30">
          <Stethoscope className="size-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Suwayomi Doctor</h1>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {s ? (
              s.reachable ? (
                <>
                  <span className="mr-1 inline-block size-1.5 rounded-full bg-emerald-500 align-middle" />
                  Connected to Suwayomi {s.version}
                </>
              ) : (
                <span className="text-rose-600 dark:text-rose-400" title={s.error ?? undefined}>
                  <span className="mr-1 inline-block size-1.5 rounded-full bg-rose-500 align-middle" />
                  Can't reach Suwayomi at {s.url}
                </span>
              )
            ) : (
              'Connecting…'
            )}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="mr-2 hidden text-right text-xs text-zinc-500 md:block dark:text-zinc-400">
            {summary?.lastScan ? (
              <div title={formatDate(summary.lastScan.startedAt)}>
                Last scan {relTime(summary.lastScan.startedAt)}
                {summary.lastScan.finishedAt
                  ? ` · took ${duration(summary.lastScan.finishedAt - summary.lastScan.startedAt)}`
                  : ''}
                {summary.lastScan.state !== 'done' ? ` · ${summary.lastScan.state}` : ''}
              </div>
            ) : (
              <div>No scan yet</div>
            )}
            {summary?.nextScanAt ? <div>Next scan {formatDate(summary.nextScanAt)}</div> : null}
          </div>
          <ThemeToggle />
          <SyncButton disabled={running || !s?.reachable} />
          <Button variant="ghost" onClick={onOpenMihon} aria-label="Clean up Mihon" title="Clean up Mihon" icon>
            <Smartphone className="size-4" />
          </Button>
          <Button variant="ghost" onClick={onOpenSettings} aria-label="Settings" icon>
            <SettingsIcon className="size-4" />
          </Button>
          {running ? (
            <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              <Square className="size-3.5 fill-current" /> Stop scan
            </Button>
          ) : (
            <Button variant="primary" onClick={() => start.mutate()} disabled={start.isPending || !s?.reachable}>
              <Play className="size-3.5 fill-current" /> Scan<span className="hidden sm:inline"> now</span>
            </Button>
          )}
        </div>
      </div>
      <ScanBar summary={summary} />
    </header>
  );
}

/** Re-reads the library from Suwayomi without contacting any source, e.g. after removing series. */
function SyncButton({ disabled }: { disabled: boolean }) {
  const sync = useSyncNow();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!sync.isSuccess && !sync.isError) return;
    setShown(true);
    const t = setTimeout(() => setShown(false), 4000);
    return () => clearTimeout(t);
  }, [sync.isSuccess, sync.isError, sync.submittedAt]);

  const label = sync.isPending
    ? 'Syncing…'
    : shown && sync.isError
      ? 'Sync failed'
      : shown && sync.data
        ? `Synced ${sync.data.series}`
        : 'Sync';
  return (
    <Button
      variant="secondary"
      onClick={() => sync.mutate()}
      aria-label={label}
      disabled={disabled || sync.isPending}
      title={
        sync.isError
          ? (sync.error as Error).message
          : 'Refresh the list from Suwayomi without contacting any source. Picks up series you removed, added or migrated.'
      }
    >
      <RefreshCw className={`size-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

function ScanBar({ summary }: { summary: Summary | undefined }) {
  const p = summary?.progress;
  if (!p?.running) return null;
  const run = p.run;
  const total = run?.total ?? 0;
  const checked = run?.checked ?? 0;
  const pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  const indeterminate = !run || run.state === 'waiting' || total === 0;
  return (
    <div className="border-t border-zinc-200/80 dark:border-zinc-800/80">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 text-xs sm:px-6">
        <span className="shrink-0 font-medium text-violet-700 dark:text-violet-300">
          {p.waitingReason ?? (indeterminate ? 'Syncing library…' : `Checking ${checked} of ${total}`)}
        </span>
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          {indeterminate ? (
            <div className="animate-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-violet-500" />
          ) : (
            <div className="h-full rounded-full bg-violet-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
          )}
        </div>
        <span className="hidden max-w-[40%] truncate text-zinc-500 sm:inline dark:text-zinc-400">{p.current.join(' · ')}</span>
      </div>
    </div>
  );
}
