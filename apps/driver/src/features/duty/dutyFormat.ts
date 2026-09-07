/**
 * Small, pure duty formatters (Phase 3C). Kept out of `useDuty.ts` so they carry no React-Query
 * dependency and can be unit-tested directly.
 */

/**
 * Elapsed on-duty time as a compact label: "6h 12m", "48m", "1h 00m". Returns null for a missing or
 * unparseable start. A clock skew that puts `now` before the start clamps to "0m" rather than showing
 * a negative duration.
 */
export function shiftDurationLabel(startedAtIso: string | null, now: number = Date.now()): string | null {
  if (!startedAtIso) return null;
  const start = new Date(startedAtIso).getTime();
  if (!Number.isFinite(start)) return null;
  const minutes = Math.max(0, Math.round((now - start) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/**
 * What the driver actually did today, for the end-of-shift summary.
 *
 * "Today" is the DEVICE's calendar day, not a UTC one: a driver signing off at 22:00 Central on the
 * 7th expects to see the 7th's work, and a UTC comparison would have already rolled them into the
 * 8th. Completion times come from the server in UTC, so the comparison has to happen after they are
 * back in local time.
 */
export function completedToday<T extends { completed_at: string | null }>(
  rows: readonly T[],
  now: Date = new Date(),
): T[] {
  const today = now.toDateString();
  return rows.filter((row) => {
    if (!row.completed_at) return false;
    const at = new Date(row.completed_at);
    return !Number.isNaN(at.getTime()) && at.toDateString() === today;
  });
}

/** Stops finished today across a set of loads — including skipped ones, which were still worked. */
export function stopsCompletedToday(
  loads: readonly { stops: readonly { status: string; completed_at: string | null }[] }[],
  now: Date = new Date(),
): number {
  return loads.reduce(
    (total, load) =>
      total
      + completedToday(
          load.stops.filter((s) => s.status === 'completed' || s.status === 'skipped'),
          now,
        ).length,
    0,
  );
}
