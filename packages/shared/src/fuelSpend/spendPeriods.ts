/**
 * Bucketing truck-days into the periods a report compares — day, week or month.
 *
 * Split out of `operatingBridge` when that file passed the 500-line budget, along the seam the code
 * already had: this decides WHICH days belong together and how an edge bucket is labelled; the bridge
 * decides what the difference between two of them means.
 */
import { periodTotals, type PeriodOptions, type SpendDay, type SpendPeriod } from "./operatingBridge.js";

export type SpendGrain = "day" | "week" | "month";

const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The period a business date belongs to, as [start, end] inclusive.
 *
 * Weeks start Monday to match how the fleet's vendors bill and how the carrier already talks about a
 * "week"; a Sunday-start series would silently disagree with every statement on the desk.
 */
export function periodBounds(ymd: string, grain: SpendGrain): { from: string; to: string } {
  if (grain === "day") return { from: ymd, to: ymd };
  if (grain === "month") {
    const from = `${ymd.slice(0, 7)}-01`;
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + 1);
    return { from, to: addDays(d.toISOString().slice(0, 10), -1) };
  }
  const d = new Date(`${ymd}T00:00:00Z`);
  const from = addDays(ymd, -((d.getUTCDay() + 6) % 7)); // Monday-start
  return { from, to: addDays(from, 6) };
}

/**
 * Bucket truck-days into periods, oldest first. Periods with no fuel at all are omitted rather than
 * emitted as zeroes — a gap in the data is not a week the fleet bought nothing, and a zero bar would
 * claim it was.
 *
 * ── WHY THE EDGES ARE CLAMPED ────────────────────────────────────────────────────────────────────
 * A bucket is a calendar week or month and the data is whatever the window holds, so the first and last
 * buckets normally stick out past it. Reported canonically, a report covering "to 2026-08-24" printed a
 * row labelled "2026-08-24 - 2026-08-30" — a period ending six days after the report ends, which reads
 * as a bug in the dates rather than as a week in progress.
 *
 * So an edge bucket is clamped to the data it actually holds and marked `partial`. `window` may be given
 * when the caller knows the requested range; without it the data's own extent is used, which is the
 * right default — a fleet that stopped fuelling on Thursday has a partial week whatever was asked for.
 */
export function spendSeries(
  days: readonly SpendDay[],
  grain: SpendGrain,
  window?: { from: string; to: string },
  opts: Omit<PeriodOptions, "partial"> = {},
): SpendPeriod[] {
  const buckets = new Map<string, { from: string; to: string; rows: SpendDay[] }>();
  let lo: string | null = window?.from ?? null;
  let hi: string | null = window?.to ?? null;
  for (const d of days) {
    if (!d.day) continue;
    if (!window) {
      if (lo == null || d.day < lo) lo = d.day;
      if (hi == null || d.day > hi) hi = d.day;
    }
    const b = periodBounds(d.day, grain);
    const existing = buckets.get(b.from);
    if (existing) existing.rows.push(d);
    else buckets.set(b.from, { ...b, rows: [d] });
  }
  return [...buckets.values()]
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .map((b) => {
      const from = lo != null && b.from < lo ? lo : b.from;
      const to = hi != null && b.to > hi ? hi : b.to;
      return periodTotals(b.rows, from, to, { ...opts, partial: from !== b.from || to !== b.to });
    });
}

/**
 * The two periods a "this vs last" comparison should use: the most recent COMPLETE period and the one
 * before it.
 *
 * A partial period is excluded because comparing a two-day week against a finished one is the single
 * easiest way to publish a fake 60% drop in spend — which the first render of the PDF report duly did,
 * announcing spend down 88%.
 *
 * Completeness is now the period's own `partial` flag rather than a date compared against "today". The
 * flag knows the bucket ran past the data; a date comparison only knew the bucket ran past the clock,
 * and got the leading edge of a window wrong every time.
 */
export function comparablePeriods(
  series: readonly SpendPeriod[],
  opts: { includePartial?: boolean } = {},
): { prior: SpendPeriod; current: SpendPeriod } | null {
  const usable = opts.includePartial === true ? [...series] : series.filter((p) => !p.partial);
  if (usable.length < 2) return null;
  return { prior: usable[usable.length - 2]!, current: usable[usable.length - 1]! };
}
