import { memo, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { SeriesView } from '../api';
import { SeriesCard } from './SeriesCard';

type Row = { kind: 'header'; name: string; count: number } | { kind: 'cards'; items: SeriesView[] };

// Same breakpoints as Tailwind's sm and xl, which the card layout was designed around.
const WIDE = '(min-width: 1280px)';
const MEDIUM = '(min-width: 640px)';
const subscribe = (cb: () => void) => {
  const queries = [WIDE, MEDIUM].map((q) => window.matchMedia(q));
  queries.forEach((q) => q.addEventListener('change', cb));
  return () => queries.forEach((q) => q.removeEventListener('change', cb));
};
const columnCount = () => (window.matchMedia(WIDE).matches ? 3 : window.matchMedia(MEDIUM).matches ? 2 : 1);
const useColumns = () => useSyncExternalStore(subscribe, columnCount);

function toRows(groups: [string, SeriesView[]][], columns: number, withHeaders: boolean): Row[] {
  const rows: Row[] = [];
  for (const [name, items] of groups) {
    if (withHeaders) rows.push({ kind: 'header', name, count: items.length });
    for (let i = 0; i < items.length; i += columns) rows.push({ kind: 'cards', items: items.slice(i, i + columns) });
  }
  return rows;
}

/**
 * The series list. Only the rows near the viewport are rendered, so a library of thousands
 * scrolls as smoothly as one of ten. Rows are measured after render, so cards can vary in height.
 */
export const SeriesGrid = memo(function SeriesGrid({
  groups,
  grouped,
  onOpen,
}: {
  /** Series to show, as [group name, series] pairs; a single unnamed group when not grouped. */
  groups: [string, SeriesView[]][];
  grouped: boolean;
  onOpen: (mangaId: number) => void;
}) {
  const columns = useColumns();
  const rows = useMemo(() => toRows(groups, columns, grouped), [groups, columns, grouped]);

  // The list sits below the header and filters; the virtualizer needs to know how far down.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const top = (listRef.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    if (Math.abs(top - scrollMargin) > 1) setScrollMargin(top);
  });

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: (i) => (rows[i]!.kind === 'header' ? 44 : 160),
    overscan: 4,
    scrollMargin,
    getItemKey: (i) => {
      const row = rows[i]!;
      return row.kind === 'header' ? `h:${row.name}` : `c:${row.items[0]!.mangaId}`;
    },
  });

  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((v) => {
        const row = rows[v.index]!;
        return (
          <div
            key={v.key}
            data-index={v.index}
            ref={virtualizer.measureElement}
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${v.start - scrollMargin}px)` }}
          >
            {row.kind === 'header' ? (
              <h2 className={`flex items-baseline gap-2 pb-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300 ${v.index > 0 ? 'pt-5' : ''}`}>
                {row.name} <span className="font-normal text-zinc-500">{row.count}</span>
              </h2>
            ) : (
              <div className="grid gap-3 pb-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
                {row.items.map((s) => (
                  <SeriesCard key={s.mangaId} series={s} onOpen={onOpen} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
