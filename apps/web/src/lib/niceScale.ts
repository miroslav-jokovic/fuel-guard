/**
 * Axis steps a reader can hold in their head (D-DT12).
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────────
 * Chart.js divides the data range by the tick count, which is arithmetically correct and unreadable:
 * a month of fuel spend topping out at $61,300 produced `$15.3K / $30.7K / $46K / $61.3K`. Nobody
 * places a bar against $30.7K. The fix is the standard "nice number" ladder — 1, 2, 2.5 and 5 times
 * a power of ten — which turns the same axis into `$0 / $20K / $40K / $60K`.
 *
 * ── WHY IT IS ITS OWN MODULE ────────────────────────────────────────────────────────────────────
 * It is a pure function over numbers, and `chartTheme.ts` is 402 lines against a 450-line warning.
 * A file that has to resolve CSS custom properties to do its job is also the hardest place in this
 * app to unit-test arithmetic: every test there needs a DOM. This needs nothing.
 *
 * 2.5 is in the ladder deliberately, and for the interval COUNT rather than for the axis maximum:
 * a series topping out at 880 wants a rough step of 220, which the 2.5 rung answers with 250 and
 * four intervals. Without that rung the next step up is 500 and the same axis carries two — half
 * the gridlines to place a bar against, for no gain anywhere. (Pinned by niceScale.test.ts's
 * "keeps the requested interval count instead of halving it", which replaced a first draft
 * asserting a plot-height effect that does not exist.)
 */

/** The multipliers, smallest first. A step must be one of these times a power of ten. */
const LADDER = [1, 2, 2.5, 5, 10] as const;

export interface NiceScale {
  /** The axis maximum — a whole multiple of `stepSize`, at or above the data's own max. */
  max: number;
  /** The gap between gridlines. */
  stepSize: number;
}

/**
 * An axis from 0 to just past `dataMax`, in steps off the ladder.
 *
 * `targetTicks` is the number of INTERVALS wanted, not lines: 4 intervals is 5 labels including the
 * zero, which is `trendOptions`' own `maxTicksLimit: 5`. Asking for more than the data can carry is
 * safe — the step can never be smaller than the ladder allows.
 *
 * ⚠ Returns a `max` of `targetTicks` for an empty or non-positive series rather than 0. A zero
 * maximum gives Chart.js a zero-height scale, which it renders as a single line with every label
 * reading `$0` — an empty chart that looks like a broken one. A 0–4 axis with no bars in it reads
 * as what it is: nothing happened yet.
 */
export function niceScale(dataMax: number, targetTicks = 4): NiceScale {
  if (!Number.isFinite(dataMax) || dataMax <= 0) return { max: targetTicks, stepSize: 1 };

  const rough = dataMax / targetTicks;
  // The power of ten at or below the rough step, so the ladder is searched in the right decade.
  const decade = 10 ** Math.floor(Math.log10(rough));
  const step = (LADDER.find((m) => m * decade >= rough) ?? 10) * decade;
  return { max: Math.ceil(dataMax / step) * step, stepSize: step };
}
