/**
 * The Fuel spend card's weeks, for a card too narrow to draw its days (SMALL-SCREENS-PLAN.md D-SM15,
 * 2026-11-16).
 *
 * ── WHY A NARROW CARD DRAWS WEEKS ───────────────────────────────────────────────────────────────
 * The default range is 31 days, and the card drew a bar for each with last period's bar behind it:
 * 62 bars. On a 390 px phone the plot is about 260 px, so a day got 8 px and its bar 5 px, and the
 * grey bar behind each one was a DIFFERENT weekday (31 days back is never the same weekday), so
 * the comparison it drew was a Saturday against a Friday. The owner: "better visible on mobile and
 * tablet". So below `DAY_SLOT_MIN_PX` a day (phones and tablets), the card draws calendar weeks,
 * Monday first (`periodBounds`, the week the vendors bill on and the Fleet MPG card's), with the figure on
 * each bar and last period's full weeks as a grey band — the Fleet MPG card's grammar (D-SM13), so
 * the two cards beside each other read the same way.
 *
 * A week's dollars are the sum of the server's own day totals; nothing is estimated. A week is FULL
 * when all seven of its days are in the series with a figure. `spendTrend` runs from the first day
 * with a fill to the last (`summariseDashboard`), so the range's first and last weeks are usually
 * short; a short week is drawn pale, named under the plot, and left out of the band, because a
 * two-day week's dollars beside a seven-day week's would read as a cheap week that did not happen.
 */
import { periodBounds, type TrendPoint } from "@silvicom/shared";
import { fullWeekBand, type WeekSpan } from "./mpgWeeks";

/**
 * Below this many pixels a day, the card draws weeks. Measured 2026-11-16 on 31 production-shaped
 * days: a phone gives a day 8 px, a tablet 20–24 px (full-width card, 768–1180), the two-column
 * desktop at 1440 11 px, a single-column desktop at 1280 27 px. The owner read the phone AND the
 * tablet as unreadable, so the line sits above the tablet's 24; days stay where a day's bar is
 * at least 14 px wide, which is where last period's bar behind it can still be told apart.
 */
export const DAY_SLOT_MIN_PX = 25;
/** What the y axis takes from the card's width, about: "$80,000" at the tick size plus its padding. */
const AXIS_PX = 64;

/** True when `days` daily bars would each get less than `DAY_SLOT_MIN_PX` of a `width` px card. */
export function drawsWeeks(width: number, days: number): boolean {
  return days > 0 && (width - AXIS_PX) / days < DAY_SLOT_MIN_PX;
}

export interface SpendWeek extends WeekSpan {
  /** The week's dollars, or null when no day in it has a figure. */
  total: number | null;
}

export function spendWeeks(points: readonly TrendPoint[]): SpendWeek[] {
  const byWeek = new Map<string, TrendPoint[]>();
  for (const p of points) {
    const key = periodBounds(p.date, "week").from;
    byWeek.set(key, [...(byWeek.get(key) ?? []), p]);
  }
  return [...byWeek.values()].map((days) => {
    const known = days.filter((d) => d.value != null);
    return {
      from: days[0]!.date,
      to: days[days.length - 1]!.date,
      days: days.length,
      full: days.length === 7 && known.length === 7,
      total: known.length ? Math.round(known.reduce((n, d) => n + d.value!, 0) * 100) / 100 : null,
    };
  });
}

/** Last period's full weeks, lowest to highest, or null when it had none. */
export const spendBand = (weeks: readonly SpendWeek[]) => fullWeekBand(weeks, (w) => w.total);

/** "$290k", "$1.2M" — the figure written on a bar and the axis tick; the exact one is in the readout. */
export function fmtMoneyShort(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
}
