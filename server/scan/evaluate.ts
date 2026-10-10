import type { Db } from '../db.js';
import { evaluate } from '../health/rules.js';
import type { Health, Settings } from '../shared/api-types.js';
import { refreshStateOf, saveEvaluation, snapshotOf, type SeriesRow, type SourceRow } from '../store.js';

/** Recomputes and stores one series' health from what Doctor currently knows. */
export function evaluateSeries(db: Db, row: SeriesRow, source: SourceRow | undefined, settings: Settings, now: number): Health {
  const { findings, health: underlying } = evaluate({
    snapshot: snapshotOf(row, source),
    refresh: refreshStateOf(row),
    sourceOutageStreak: source?.outage_streak ?? 0,
    staleDays: settings.staleDays,
    now,
  });
  const ignored = row.ignored_until !== null && row.ignored_until > now;
  const unhealthy = underlying === 'broken' || underlying === 'warning';
  const health: Health = ignored ? 'ignored' : underlying;
  saveEvaluation(db, row.manga_id, {
    health,
    underlying,
    findings,
    firstUnhealthyAt: unhealthy ? (row.first_unhealthy_at ?? now) : null,
  });
  return health;
}
