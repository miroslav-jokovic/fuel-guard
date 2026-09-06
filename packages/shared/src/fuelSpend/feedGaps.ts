/**
 * Days the fuel feed delivered nothing, in the MIDDLE of a window that has data either side.
 *
 * ── WHY FRESHNESS WAS NOT ENOUGH ───────────────────────────────────────────────────────────────
 * `describeFeedFreshness` answers "when did anything last arrive", which catches a poller that has
 * stopped. It cannot catch a poller that stopped and then STARTED AGAIN: the freshness line reads
 * "purchases last arrived 3 minutes ago" and is perfectly true, while a fortnight in the middle of the
 * record is simply absent. Nothing on any screen is wrong — every page is short by exactly the fuel
 * that never arrived, and short looks like quiet.
 *
 * **Measured on production 2026-09-05, which is how this file came to exist.** Across seven months of
 * fills — 2026-02-01 to 2026-09-03, 215 days — there are exactly **17 days with no fill at all, and
 * they are one contiguous block**: 2026-04-18 through 2026-05-04. The raw vendor rows are missing for
 * the same 17 days, so it was never a processing failure; those days were never collected. Against
 * Samsara's own IFTA jurisdiction miles the fleet drove normally throughout, which puts the hole at
 * roughly **119,000 gallons and $590,000 of fuel absent from the record**. It sat there for four
 * months, and the thing that eventually found it was a person comparing two unrelated numbers.
 *
 * ── WHY THE THRESHOLD IS ONE DAY, WHICH IS NOT AN OPINION ──────────────────────────────────────
 * The obvious worry is a detector that cries wolf — a quiet Sunday, a holiday, a small fleet. It does
 * not apply here and the data says so rather than the author: in those same 215 days **every single
 * day outside that block has fills**, weekends and holidays included, because a working fleet of ~165
 * tractors buys fuel every day. So one empty day is already an event, and a threshold of two would
 * have found this hole a day later for no gain.
 *
 * It is stated as a parameter rather than a constant anyway, because a fleet of nine trucks has quiet
 * Sundays and this rule should be able to serve it without being rewritten (`minGapDays`).
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────────────────────────
 * It does not report a gap at either END of the window. A window that starts before the carrier's
 * first fill, or ends today before today's fills have arrived, has empty days that mean "outside the
 * record" rather than "missing from it" — and a line that called those a gap would be wrong twice a
 * day, which is how a warning becomes wallpaper. Only runs with data on BOTH sides are reported: a
 * gap is a hole, and a hole needs an edge on each side.
 *
 * Pure. No clock, no I/O, no table (D-ARC1) — the caller supplies the days it counted.
 */

/** One day and how many fills it holds. `day` is `YYYY-MM-DD`; the caller's own window decides which. */
export interface FeedDayCount {
  day: string;
  fills: number;
}

export interface FeedGap {
  /** First empty day, inclusive. */
  from: string;
  /** Last empty day, inclusive. */
  to: string;
  days: number;
  /**
   * Fills a day like this one normally holds, from the days that DID deliver in the same window —
   * the median, so one enormous catch-up day cannot inflate it. Null when there is nothing to
   * compare against.
   */
  typicalFillsPerDay: number | null;
  /** `days × typicalFillsPerDay`, rounded. What is probably missing, stated as an estimate. */
  estimatedMissingFills: number | null;
}

export interface FeedGapReport {
  gaps: FeedGap[];
  /** Days in the window that held no fill at all, including the edges this does not report. */
  emptyDays: number;
  /** Days examined between the first and last day that delivered. */
  coveredDays: number;
  /** One sentence for a surface, or null when the record has no holes in it. */
  lead: string | null;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const label = (ymd: string): string => {
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    : ymd;
};

/**
 * Find the holes. `days` may arrive in any order and need not be complete — the caller counted what
 * the table holds, and a day it never saw is as empty as one it saw with zero fills.
 */
export function detectFeedGaps(
  days: readonly FeedDayCount[],
  opts: { minGapDays?: number } = {},
): FeedGapReport {
  const minGapDays = Math.max(1, opts.minGapDays ?? 1);
  const byDay = new Map<string, number>();
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.day)) continue;
    byDay.set(d.day, (byDay.get(d.day) ?? 0) + Math.max(0, Math.trunc(d.fills)));
  }
  const delivered = [...byDay.entries()].filter(([, n]) => n > 0).map(([day]) => day).sort();
  const empty = { gaps: [] as FeedGap[], emptyDays: 0, coveredDays: 0, lead: null };
  if (delivered.length < 2) return empty;

  // The window is the RECORD's own extent, not the caller's: a gap needs data on both sides, so the
  // first and last days that delivered are the only edges that can bound one.
  const first = Date.parse(`${delivered[0]!}T00:00:00Z`);
  const last = Date.parse(`${delivered[delivered.length - 1]!}T00:00:00Z`);
  const typical = median([...byDay.values()].filter((n) => n > 0));

  const gaps: FeedGap[] = [];
  let emptyDays = 0;
  let coveredDays = 0;
  let runStart: string | null = null;
  let runDays = 0;

  const close = () => {
    if (runStart != null && runDays >= minGapDays) {
      const to = new Date(Date.parse(`${runStart}T00:00:00Z`) + (runDays - 1) * 86_400_000)
        .toISOString()
        .slice(0, 10);
      gaps.push({
        from: runStart,
        to,
        days: runDays,
        typicalFillsPerDay: typical,
        estimatedMissingFills: typical == null ? null : Math.round(typical * runDays),
      });
    }
    runStart = null;
    runDays = 0;
  };

  for (let t = first; t <= last; t += 86_400_000) {
    const ymd = new Date(t).toISOString().slice(0, 10);
    coveredDays += 1;
    if ((byDay.get(ymd) ?? 0) > 0) {
      close();
      continue;
    }
    emptyDays += 1;
    if (runStart == null) runStart = ymd;
    runDays += 1;
  }
  // No `close()` here on purpose: a run still open at `last` cannot exist, because `last` delivered.

  if (gaps.length === 0) return { gaps: [], emptyDays, coveredDays, lead: null };

  const worst = gaps.reduce((a, b) => (b.days > a.days ? b : a));
  const totalDays = gaps.reduce((n, g) => n + g.days, 0);
  const missing = gaps.reduce((n, g) => n + (g.estimatedMissingFills ?? 0), 0);
  const span = worst.from === worst.to ? label(worst.from) : `${label(worst.from)} – ${label(worst.to)}`;
  const rest = gaps.length === 1 ? "" : ` and ${gaps.length - 1} other gap${gaps.length === 2 ? "" : "s"}`;
  const scale = missing > 0 ? ` — roughly ${missing.toLocaleString("en-US")} fill${missing === 1 ? "" : "s"} are missing rather than absent from the fleet` : "";
  return {
    gaps,
    emptyDays,
    coveredDays,
    lead:
      `No fuel arrived at all for ${totalDays} day${totalDays === 1 ? "" : "s"} inside this window (${span}${rest})${scale}. ` +
      `Every figure covering those days is short by whatever was bought on them.`,
  };
}
