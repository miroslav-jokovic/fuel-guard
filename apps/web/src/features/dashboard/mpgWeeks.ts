/**
 * The Fleet MPG card's weeks, read for what they are (SMALL-SCREENS-PLAN.md D-SM13, 2026-11-16).
 *
 * ── WHY A WEEK HAS TO SAY HOW MANY DAYS IT IS ──────────────────────────────────────────────────
 * The series is cut on calendar weeks, Monday first (`periodBounds`, the week the vendors bill on),
 * and each bucket is clamped to the picked dates. So the default 31-day range opens on whatever
 * weekday it opens on. On 2026-11-16 it opened on a Saturday, and its first "week" was two days:
 * Saturday and Sunday. Those are the fleet's lowest-MPG days, because the trucks fill up for the week
 * ahead and Monday's fill is small. Production's rollup, 2026-09-12 → 11-15: every Sunday read
 * 5.8–7.0, every Monday 7.3–9.6, and that two-day bucket read 6.30 between full weeks of 6.96–7.17.
 * The card drew it as a full-width week, the line dipped, and the reader saw a bad week that did
 * not happen. The last bucket has the same problem from the other end: the roll-up reaches
 * yesterday at best, so the current week is always a few days short.
 *
 * So a week here carries its day count, and only a FULL week (seven days, nothing clamped off by
 * the roll-up) is drawn solid or counted in last period's band. A part-week is still shown, pale,
 * with how many days it holds: hiding it would leave the range's first or last days out of the
 * picture without saying so.
 *
 * Nothing here computes an MPG (D-MPG1, `lint:mpg`). Each figure is the server's own, for the days
 * the server says it covers.
 */
import { dateRangeDays, formatDisplayDayShort, formatFleetMpg } from "@silvicom/shared";

/** The fields of a `FleetMpgPeriod` this file reads. */
export interface MpgBucket {
  from: string;
  to: string;
  mpg: number | null;
  /** The roll-up stopped short of this bucket's requested end (`resolveFleetMpgWindow`). */
  partial: boolean;
}

export interface MpgWeek {
  from: string;
  to: string;
  mpg: number | null;
  days: number;
  /** Seven days, none of them cut off by the picked dates or by the roll-up's reach. */
  full: boolean;
}

export function readWeeks(buckets: readonly MpgBucket[]): MpgWeek[] {
  return buckets.map((b) => {
    const days = dateRangeDays(b.from, b.to).length;
    return { from: b.from, to: b.to, mpg: b.mpg, days, full: days === 7 && !b.partial };
  });
}

/**
 * Where last period's FULL weeks sat, lowest to highest, or null when it had none. A part-week is
 * left out for the reason this file exists: one two-day weekend bucket would widen the band by a
 * whole MPG and make every real week look normal.
 */
export function bandOf(weeks: readonly MpgWeek[]): { lo: number; hi: number } | null {
  const vals = weeks.filter((w) => w.full && w.mpg != null).map((w) => w.mpg!);
  return vals.length ? { lo: Math.min(...vals), hi: Math.max(...vals) } : null;
}

const day = (ymd: string) => formatDisplayDayShort(ymd, ymd);

/** "week of 10/19", or "10/17 – 10/18 · 2 days" for a part-week — what the readout says on hover. */
export function weekCaption(w: MpgWeek): string {
  return w.full ? `week of ${day(w.from)}` : `${day(w.from)} – ${day(w.to)} · ${w.days} ${w.days === 1 ? "day" : "days"}`;
}

/**
 * The one line under the plot that explains a pale bar, or null when every week is full. Names the
 * part-weeks by their dates and day counts — "pale" alone would leave the reader to guess why.
 */
export function partWeekNote(weeks: readonly MpgWeek[]): string | null {
  const part = weeks.filter((w) => !w.full);
  if (!part.length) return null;
  const list = part.map((w) => `${day(w.from)} – ${day(w.to)} (${w.days} ${w.days === 1 ? "day" : "days"})`).join(" and ");
  return `Pale: ${list}, not a full week, so not compared.`;
}

export const mpgText = (v: number) => `${formatFleetMpg(v)} MPG`;
