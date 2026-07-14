/**
 * Rank drivers on a trailing multi-week average of their weekly finals (pure, §3.5). Candidates are the
 * drivers eligible in the CURRENT (most-recent) week; their trailingFinal averages weekFinal over the last
 * `trailingWeeks` weeks in which they were eligible. Deterministic tie-break ladder, top-N flagged winners.
 */
import type { LeaderboardRow, PerformanceSettings, WeekLeaderboard } from "./types.js";

/** `weeks[0]` is the current week, `weeks[1]` the prior week, etc. (most-recent first). */
export function rankTrailing(
  weeks: WeekLeaderboard[],
  settings: PerformanceSettings,
): LeaderboardRow[] {
  if (weeks.length === 0) return [];
  const current = weeks[0]!;
  const window = weeks.slice(0, settings.trailingWeeks);

  const finalsByDriver = new Map<string, number[]>();
  for (const wk of window) {
    for (const r of wk.rows) {
      if (r.weekFinal == null) continue;
      const arr = finalsByDriver.get(r.driverId) ?? [];
      arr.push(r.weekFinal);
      finalsByDriver.set(r.driverId, arr);
    }
  }

  const priorWeekFinal = new Map<string, number>();
  if (weeks.length > 1) {
    for (const r of weeks[1]!.rows) {
      if (r.weekFinal != null) priorWeekFinal.set(r.driverId, r.weekFinal);
    }
  }

  const candidates = current.rows.filter((r) => r.eligible && r.weekFinal != null);
  const ranked = candidates
    .map((cur) => {
      const finals = finalsByDriver.get(cur.driverId) ?? [cur.weekFinal!];
      const trailingFinal = Math.round((finals.reduce((s, v) => s + v, 0) / finals.length) * 10) / 10;
      return { driverId: cur.driverId, driverName: cur.driverName, trailingFinal, weeksCounted: finals.length, current: cur };
    })
    .sort(
      (a, b) =>
        b.trailingFinal - a.trailingFinal ||
        (b.current.safetyPct ?? 0) - (a.current.safetyPct ?? 0) ||
        (b.current.miles ?? 0) - (a.current.miles ?? 0) ||
        (b.current.idlePct ?? 0) - (a.current.idlePct ?? 0) ||
        (priorWeekFinal.get(b.driverId) ?? 0) - (priorWeekFinal.get(a.driverId) ?? 0) ||
        (a.driverId < b.driverId ? -1 : a.driverId > b.driverId ? 1 : 0),
    );

  return ranked.map((r, i) => ({ ...r, rank: i + 1, isWinner: i < settings.rewardTopN }));
}
