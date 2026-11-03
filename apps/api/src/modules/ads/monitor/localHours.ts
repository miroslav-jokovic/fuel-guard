import { wallClockInZone, wallClockToUtc } from "@silvicom/shared";

/**
 * The ad account's wall clock ↔ UTC, for the hourly pull (B5a). Meta reports insights "in the ad account's
 * timezone" (Insights best practices) and its hourly breakdown is a LOCAL wall-clock hour
 * (`"14:00:00 - 14:59:59"` on a `date_start` day). `ads_spend_hourly.hour` is a UTC hour (0537's CHECK), so
 * every bucket is converted here, once. Pure; the zone is an IANA name (`timezone_name`), and the clock
 * arithmetic is `calendarDay.ts`'s (`wallClockInZone`/`wallClockToUtc`), the repo's one definition.
 *
 * ── THE TWO DAYS A YEAR A LOCAL HOUR IS NOT ONE UTC HOUR ─────────────────────────────────────────
 *   · Fall back (America/Chicago, first Sunday of November): 01:00–01:59 happens twice, at 06:00Z and
 *     07:00Z. Meta's bucket is the wall-clock hour, so ONE bucket holds both hours' spend. It is stored on
 *     the FIRST of the two UTC hours, whole: the day's total stays exact and no split is invented. The
 *     second UTC hour simply has no row, which every reader already reads as zero.
 *   · Spring forward (second Sunday of March): 02:00–02:59 does not exist, so Meta has no such bucket.
 *     If one ever came, `localHourToUtc` answers null and the pull reports it rather than guessing.
 */

/** The local `YYYY-MM-DD` and hour of a UTC instant in `zone` (`calendarDay.ts`'s clock, not a second one). */
export function localOf(at: Date, zone: string): { day: string; hour: number; minute: number } {
  const wc = wallClockInZone(at, zone);
  return { day: `${wc.year}-${String(wc.month).padStart(2, "0")}-${String(wc.day).padStart(2, "0")}`, hour: wc.hour, minute: wc.minute };
}

/** True when `zone` is an IANA zone this runtime can convert in. */
export function isKnownZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try {
    wallClockInZone(new Date(0), zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The UTC hour a local wall-clock hour starts at, or null when that local hour never happens. Derived from
 * `calendarDay.ts`'s `wallClockToUtc` (ambiguous → first occurrence, as the header needs); that function
 * resolves a NON-existent time backward, so the answer is read back and refused unless it is the hour asked.
 */
export function localHourToUtc(day: string, hour: number, zone: string): Date | null {
  const [year, month, d] = day.split("-").map(Number) as [number, number, number];
  const at = new Date(wallClockToUtc({ year, month, day: d, hour, minute: 0, second: 0 }, zone));
  const back = localOf(at, zone);
  return back.day === day && back.hour === hour && back.minute === 0 ? at : null;
}

/** The local days, oldest first, from `days - 1` days before today (in `zone`) through today. */
export function windowDays(now: Date, zone: string, days: number): string[] {
  const today = localOf(now, zone).day;
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(new Date(Date.UTC(y, m - 1, d - i)).toISOString().slice(0, 10));
  return out;
}

/** `"14:00:00 - 14:59:59"` → 14; null for anything else. */
export function bucketHour(bucket: unknown): number | null {
  const m = typeof bucket === "string" ? /^(\d{2}):00:00 - \1:59:59$/.exec(bucket) : null;
  const h = m ? Number(m[1]) : NaN;
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : null;
}
