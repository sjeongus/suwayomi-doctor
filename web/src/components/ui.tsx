import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { CheckCircle2, CircleDashed, EyeOff, OctagonAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { Health } from '../api';

export const HEALTH: Record<Health, { label: string; icon: LucideIcon; text: string; bg: string; ring: string; dot: string }> = {
  broken: {
    label: 'Broken',
    icon: OctagonAlert,
    text: 'text-rose-700 dark:text-rose-300',
    bg: 'bg-rose-50 dark:bg-rose-500/10',
    ring: 'ring-rose-200 dark:ring-rose-500/30',
    dot: 'bg-rose-500',
  },
  warning: {
    label: 'Warning',
    icon: TriangleAlert,
    text: 'text-amber-700 dark:text-amber-300',
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    ring: 'ring-amber-200 dark:ring-amber-500/30',
    dot: 'bg-amber-500',
  },
  healthy: {
    label: 'Healthy',
    icon: CheckCircle2,
    text: 'text-emerald-700 dark:text-emerald-300',
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    ring: 'ring-emerald-200 dark:ring-emerald-500/30',
    dot: 'bg-emerald-500',
  },
  unchecked: {
    label: 'Unchecked',
    icon: CircleDashed,
    text: 'text-zinc-600 dark:text-zinc-400',
    bg: 'bg-zinc-100 dark:bg-zinc-800/60',
    ring: 'ring-zinc-200 dark:ring-zinc-700',
    dot: 'bg-zinc-400',
  },
  ignored: {
    label: 'Ignored',
    icon: EyeOff,
    text: 'text-zinc-500 dark:text-zinc-400',
    bg: 'bg-zinc-100 dark:bg-zinc-800/60',
    ring: 'ring-zinc-200 dark:ring-zinc-700',
    dot: 'bg-zinc-400',
  },
};

export function HealthBadge({ health, size = 'sm' }: { health: Health; size?: 'sm' | 'md' }) {
  const h = HEALTH[health];
  const Icon = h.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ring-1 ring-inset ${h.bg} ${h.text} ${h.ring} ${
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
      }`}
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
      {h.label}
    </span>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-violet-600 text-white hover:bg-violet-500 shadow-sm shadow-violet-900/20 disabled:bg-violet-600/50',
  secondary:
    'bg-white text-zinc-800 ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-700 dark:hover:bg-zinc-800',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-500',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon = false,
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; icon?: boolean; children: ReactNode }) {
  const sizing = icon ? (size === 'sm' ? 'size-8' : 'size-9') : size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:shrink-0 ${sizing} ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function relTime(epochSec: number | null | undefined, now = Date.now() / 1000): string {
  if (!epochSec) return 'never';
  const diff = epochSec - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return 'just now';
}

export function formatDate(epochSec: number | null | undefined): string {
  if (!epochSec) return '—';
  return new Date(epochSec * 1000).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function duration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** A cover with a graceful fallback when Suwayomi has none. */
export function Cover({ src, title, className = '' }: { src: string; title: string; className?: string }) {
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-800 dark:to-zinc-900 ${className}`}>
      <span className="absolute inset-0 grid place-items-center text-lg font-semibold text-zinc-500 dark:text-zinc-600">{initials}</span>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        className="relative size-full object-cover"
        onError={(e) => (e.currentTarget.style.display = 'none')}
      />
    </div>
  );
}
