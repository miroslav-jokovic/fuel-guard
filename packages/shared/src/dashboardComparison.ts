/**
 * Period-over-period comparison for the Dashboard (DR2b, D-DR12; FLEET-OVERVIEW-REDESIGN-PROPOSAL
 * D-FO3 / Q-FO1).
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────────────────────────
 * Until 2026-10-06 no figure on the Fleet overview had a reference: `useDashboard` fetched one
 * window and nothing else, so `$1.30M` was a fact and never information. The comps draw a delta
 * pill on every tile; D-DR12 split the pill out because the data behind it did not exist, and this
 * module is that data's arithmetic — pure, so the API can grow a server-side aggregate later
 * without a second definition of "previous period" appearing anywhere.
 *
 * ── THE PREVIOUS WINDOW IS THE SAME LENGTH, ENDING THE DAY BEFORE ────────────────────────────────
 * Not "last month". The picker is an arbitrary span of calendar days (D-PREC5: calendar, never
 * instants), and the only comparison that is honest for an arbitrary span is the span of the same
 * length immediately before it. 31 days ending Sep 18 compares with the 31 ending Aug 18. A
 * same-length window also keeps weekday mix close enough that a 7-day pick does not compare a
 * Mon–Sun with a Thu–Wed.
 *
 * ── `upIsGood` IS THE CALLER'S VERDICT, NEVER DERIVED FROM THE SIGN (D-DT8, D-DR4) ───────────────
 * Spend up is bad; MPG up is good. A helper that decides from the arrow is wrong on half of any
 * real KPI row, so `deltaTone` takes the verdict as an argument and `periodDelta` says nothing
 * about good or bad at all.
 *
 * ── FLAT IS A DASH, ALONE (D-DT4) ────────────────────────────────────────────────────────────────
 * A change that would print as "0.0%" is reported as `flat`, and the pill draws a dash with no
 * number. "— 0%" says the same thing twice on a tile with no movement to report.
 */
import { lastDaysStart, shiftDay, type CalendarDay } from "./calendarDay.js";
import { dateRangeDays } from "./dashboard.js";

export interface DayWindow {
  from: CalendarDay;
  to: CalendarDay;
}

/** The same number of calendar days, ending the day before `from`. */
export function previousWindow(w: DayWindow): DayWindow {
  const length = dateRangeDays(w.from, w.to).length;
  const to = shiftDay(w.from, -1);
  return { from: lastDaysStart(to, length), to };
}

export type DeltaDirection = "up" | "down" | "flat";

export interface PeriodDelta {
  /** `current − previous`, in the measure's own unit. */
  abs: number;
  /** Percent of the previous value; `null` when the previous value is zero (no honest ratio). */
  pct: number | null;
  direction: DeltaDirection;
}

/**
 * Below this a percentage prints as "0.0%" at one decimal, which is the point at which a reader
 * is told there was movement and shown none.
 */
const FLAT_PCT = 0.05;

/**
 * `null` when either side is missing — a withheld MPG, a previous window that has not loaded —
 * because a pill drawn against an absent number is the defect D-DR7 and D-DR12 both refused.
 */
export function periodDelta(
  current: number | null | undefined,
  previous: number | null | undefined,
): PeriodDelta | null {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const abs = current - previous;
  const pct = previous === 0 ? null : (abs / Math.abs(previous)) * 100;
  const flat = pct == null ? abs === 0 : Math.abs(pct) < FLAT_PCT;
  const direction: DeltaDirection = flat ? "flat" : abs > 0 ? "up" : "down";
  return { abs, pct, direction };
}

export type DeltaTone = "good" | "bad" | "neutral";

/** The caller says which way is good; flat is never a verdict. */
export function deltaTone(d: PeriodDelta, upIsGood: boolean): DeltaTone {
  if (d.direction === "flat") return "neutral";
  return (d.direction === "up") === upIsGood ? "good" : "bad";
}

/**
 * The pill's text — no arrow, no sign; the component draws the direction (one encoding of
 * movement, D-DT2). Percent by default; `abs` for a measure whose own unit reads better than a
 * ratio (MPG moves by tenths, and "4%" of 7.4 MPG is a figure nobody has in their head).
 */
export function deltaLabel(d: PeriodDelta, unit: "pct" | "abs" = "pct", digits?: number): string {
  if (d.direction === "flat") return "";
  if (unit === "abs" || d.pct == null) {
    const n = Math.abs(d.abs);
    return n.toLocaleString("en-US", { maximumFractionDigits: digits ?? 1, minimumFractionDigits: digits ?? 0 });
  }
  const p = Math.abs(d.pct);
  // Whole percent from 10 up ("12%"), one decimal below it ("3.4%") — the precision a glance can use.
  return `${p >= 10 ? Math.round(p) : p.toFixed(digits ?? 1)}%`;
}
