import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useSaveSettings, useSettings, type Settings, type Summary } from '../api';
import { Button, formatDate } from './ui';

const PRESETS: { label: string; cron: string }[] = [
  { label: 'Weekly, Sunday 4:00', cron: '0 4 * * 0' },
  { label: 'Daily, 4:00', cron: '0 4 * * *' },
  { label: 'Every 3 days, 4:00', cron: '0 4 */3 * *' },
  { label: 'Monthly, 1st at 4:00', cron: '0 4 1 * *' },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>}
    </label>
  );
}

const inputCls =
  'h-9 w-full rounded-lg border-0 bg-white px-3 text-sm ring-1 ring-inset ring-zinc-300 focus:ring-2 focus:ring-violet-500 focus:outline-none dark:bg-zinc-950 dark:ring-zinc-700';

export function SettingsDialog({ open, onClose, summary }: { open: boolean; onClose: () => void; summary: Summary | undefined }) {
  const settings = useSettings();
  const save = useSaveSettings();
  const [draft, setDraft] = useState<Settings | null>(null);

  useEffect(() => {
    if (open && settings.data) setDraft(settings.data);
    if (!open) save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.data]);

  if (!open || !draft) return null;
  const s = summary?.suwayomi;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft({ ...draft, [k]: v });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-zinc-950/50 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Settings" className="relative w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4">
          <Field label="Scan schedule" hint={`Cron format, in the server's timezone. Next run: ${formatDate(summary?.nextScanAt)}`}>
            <div className="flex gap-2">
              <select
                className={inputCls}
                value={PRESETS.some((p) => p.cron === draft.scanCron) ? draft.scanCron : 'custom'}
                onChange={(e) => e.target.value !== 'custom' && set('scanCron', e.target.value)}
              >
                {PRESETS.map((p) => (
                  <option key={p.cron} value={p.cron}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
              <input className={`${inputCls} max-w-36 font-mono`} value={draft.scanCron} onChange={(e) => set('scanCron', e.target.value)} />
            </div>
          </Field>
          <Field label="Stale after (days)" hint="Ongoing series with no new chapter for this long get a warning.">
            <input type="number" min={1} className={inputCls} value={draft.staleDays} onChange={(e) => set('staleDays', Number(e.target.value))} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sources in parallel" hint="One series per source at a time.">
              <input type="number" min={1} max={10} className={inputCls} value={draft.sourceConcurrency} onChange={(e) => set('sourceConcurrency', Number(e.target.value))} />
            </Field>
            <Field label="Delay per source (ms)" hint="Pause between series on one source.">
              <input type="number" min={0} step={500} className={inputCls} value={draft.delayMs} onChange={(e) => set('delayMs', Number(e.target.value))} />
            </Field>
          </div>

          <div className="rounded-xl bg-zinc-50 p-3 text-sm dark:bg-zinc-950">
            <div className="font-medium">Suwayomi connection</div>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-zinc-600 dark:text-zinc-400">
              <dt>Server</dt>
              <dd className="truncate font-mono text-xs leading-5">{s?.url}</dd>
              <dt>Links open</dt>
              <dd className="truncate font-mono text-xs leading-5">{s?.publicUrl}</dd>
              <dt>Status</dt>
              <dd className={s?.reachable ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                {s?.reachable ? `Connected · ${s.version}` : (s?.error ?? 'Unknown')}
              </dd>
            </dl>
            <p className="mt-2 text-xs text-zinc-500">These come from the container's environment (SUWAYOMI_URL, SUWAYOMI_PUBLIC_URL).</p>
          </div>
        </div>

        {save.isError && <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{save.error.message}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate(draft, { onSuccess: onClose })}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
