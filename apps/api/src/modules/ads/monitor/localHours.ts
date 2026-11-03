/**
 * The ad account's wall clock ↔ UTC, for the hourly pull (B5a). Meta reports insights "in the ad account's
 * timezone" (Insights best practices) and its hourly breakdown is a LOCAL wall-clock hour
 * (`"14:00:00 - 14:59:59"` on a `date_start` day). `ads_spend_hourly.hour` is a UTC hour (0537's CHECK), so
 * every bucket is converted here, once. Pure; the zone is an IANA name (`timezone_name`), read through
 * `Intl`, so a zone's rules — including a country that changes them — are the runtime's, not a table of ours.
 *
 * ── THE TWO DAYS A YEAR A LOCAL HOUR IS NOT ONE UTC HOUR ─────────────────────────────────────────
 *   · Fall back (America/Chicago, first Sunday of November): 01:00–01:59 happens twice, at 06:00Z and
 *     07:00Z. Meta's bucket is the wall-clock hour, so ONE bucket holds both hours' spend. It is stored on
 *     the FIRST of the two UTC hours, whole: the day's total stays exact and no split is invented. The
 *     second UTC hour simply has no row, which every reader already reads as zero.
 *   · Spring forward (second Sunday of March): 02:00–02:59 does not exist, so Meta has no such bucket.
 *     If one ever came, `localHourToUtc` answers null and the pull reports it rather than guessing.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    formatters.set(zone, f);
  }
  return f;
}

/** The local `YYYY-MM-DD` and hour of a UTC instant in `zone`. Throws on a zone `Intl` does not know. */
export function localOf(at: Date, zone: string): { day: string; hour: number; minute: number } {
  const p = Object.fromEntries(formatter(zone).formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** True when `zone` is an IANA zone this runtime can convert in. */
export function isKnownZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone) return false;
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The UTC hour a local wall-clock hour starts at: the EARLIEST instant whose local reading is `day hour:00`
 * (header: a fall-back hour lands on its first occurrence), or null when that local hour never happens.
 */
export function localHourToUtc(day: string, hour: number, zone: string): Date | null {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const asIfUtc = Date.UTC(y, m - 1, d, hour);
  // Every real offset is within ±14 h and a multiple of 15 minutes: try each, keep the earliest match.
  // 113 candidates, one format call each — trivial against an HTTP round trip, and no offset table to keep.
  let best: number | null = null;
  for (let q = -56; q <= 56; q += 1) {
    const t = asIfUtc - q * 15 * 60_000;
    const l = localOf(new Date(t), zone);
    if (l.day === day && l.hour === hour && l.minute === 0 && (best === null || t < best)) best = t;
  }
  return best === null ? null : new Date(best);
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
