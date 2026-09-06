/**
 * The policy figures, graded against the targets the carrier set (C8, D-FUI10).
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────────────────────
 * C8 shipped the three targets and `varianceToTarget`, and then nothing called it: the settings page
 * could SET "at least 95% on the preferred network" and no page in the section rendered a share for
 * that number to grade. The Done-when — *no policy figure renders as a bare count* — is a statement
 * about a rendered figure, so the figure has to be computed somewhere the page can reach. This is
 * that somewhere, and it is pure: lines in, grades out, no clock.
 *
 * ── THE TWO KINDS OF TARGET NEED TWO KINDS OF WINDOW ───────────────────────────────────────────
 * On-network share is a RATIO. It means the same thing over a week, a quarter or the reader's chosen
 * window, so it is graded once over every line handed in. Avoided-state gallons is a COUNT against a
 * ceiling stated per `AVOIDED_STATE_TARGET_PERIOD` — a month — so it is bucketed per calendar month
 * and each month is graded on its own. A 90-day window with 12,000 avoided-state gallons is not
 * "three times over a 4,000 ceiling"; it is three months, each of which met the ceiling or did not.
 *
 * ── A PARTIAL MONTH IS A FLOOR, AND SAYS SO ─────────────────────────────────────────────────────
 * The reader's window rarely lands on month boundaries. A month the window only half covers has only
 * half its gallons counted, so "met" for that month proves nothing — the other half is not here —
 * while "missed" is already conclusive, because more gallons could only make it worse. `partial` is
 * carried on the row so the renderer can say which of the two it is looking at rather than grading
 * a fortnight as though it were a month. The period's bounds come from `monthBounds`, which C6
 * already owns, so the month here is the month a finding covers.
 *
 * ── EVERY MONTH IN THE WINDOW IS A ROW, INCLUDING THE ONES WITH NOTHING IN THEM ─────────────────
 * Bucketing only the months that have an avoided-state fill would drop the months the fleet stayed
 * out of California entirely — the months that MET the ceiling with the most room. The months are
 * enumerated from the window, and a month with no such fill is graded at zero gallons.
 *
 * ── THE RULE IS READ FROM WHERE IT LIVES ────────────────────────────────────────────────────────
 * "Off-network" and "in an avoided state" come from `policyPredicates`, the same closure
 * `analyzePolicyExceptions` and the C6 producer use. The unresolved-brand clause in particular —
 * a fill whose station could not be matched counts as off-network — is inherited rather than
 * restated, and is also why the share carries `unresolvedPct` beside it: the true on-network share
 * lies somewhere between the figure and the figure plus the unresolved share, and a reader
 * comparing 96.5% to a 95% floor is entitled to know the margin is inside the measurement error.
 *
 * ── DISCOUNT CAPTURE HAS A TARGET AND NO FIGURE, AND THIS MODULE SAYS SO RATHER THAN GUESSING ────
 * "Share of the available discount actually captured" needs the posted price on every fill, and the
 * posted price only ever arrives on the vendor's statement — `fuel_statements` has held zero rows for
 * eight months (Q-FUI7). There is no shared definition of a capture SHARE to grade, and inventing
 * one here from the feed's partial retail coverage would grade a number nobody has agreed means
 * that. So the grade carries the target and a null actual, and the renderer states what is missing.
 */
import { monthBounds } from "./policyFindings.js";
import {
  policyPredicates,
  varianceToTarget,
  type FuelPolicy,
  type TargetVariance,
} from "./policyExceptions.js";
import { isTractorFuel, type SpendLine } from "./types.js";

export interface ShareGrade {
  /** The share, 0–100 to match the target's unit. Null when there were no tractor gallons at all. */
  actualPct: number | null;
  gallons: number;
  allGallons: number;
  /**
   * Share of tractor gallons, 0–100, whose station could not be resolved to a brand. These count as
   * OFF-network by the rule, so the true on-network share is in `[actualPct, actualPct + unresolvedPct]`.
   */
  unresolvedPct: number | null;
  /** Null when there is no target, or no figure — render the share as it rendered before C8. */
  variance: TargetVariance | null;
}

export interface MonthGrade {
  /** `YYYY-MM`. */
  month: string;
  /** Tractor gallons bought in `policy.avoidStates` during this month, inside the window. */
  gallons: number;
  /** The window does not cover the whole month, so `gallons` is a floor and "met" is not conclusive. */
  partial: boolean;
  variance: TargetVariance | null;
}

export interface PolicyTargetGrades {
  onNetwork: ShareGrade;
  /** One row per calendar month the window touches, oldest first, every month present. */
  avoidedStateByMonth: MonthGrade[];
  /** The target as set. There is no figure to grade it against until a statement exists. */
  discountCaptureTargetPct: number | null;
}

export interface GradeWindow {
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Every `YYYY-MM` from the month of `from` to the month of `to`, inclusive. Calendar arithmetic only. */
export function monthsInWindow(window: GradeWindow): string[] {
  const start = window.from.slice(0, 7);
  const end = window.to.slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(start) || !/^\d{4}-\d{2}$/.test(end) || start > end) return [];
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number) as [number, number];
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key === end) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

export function gradePolicyTargets(
  lines: readonly SpendLine[],
  policy: FuelPolicy,
  window: GradeWindow,
): PolicyTargetGrades {
  const { isAvoidedState, isOffNetwork } = policyPredicates(policy);
  const fuel = lines.filter(isTractorFuel);

  // ── on-network: one ratio over the whole window ──────────────────────────────────────────────
  const allGallons = fuel.reduce((a, l) => a + l.gallons, 0);
  const onGallons = fuel.filter((l) => !isOffNetwork(l)).reduce((a, l) => a + l.gallons, 0);
  const unresolvedGallons = fuel.filter((l) => l.brand == null).reduce((a, l) => a + l.gallons, 0);
  const actualPct = allGallons > 0 ? r1((onGallons / allGallons) * 100) : null;
  const onNetwork: ShareGrade = {
    actualPct,
    gallons: onGallons,
    allGallons,
    unresolvedPct: allGallons > 0 ? r1((unresolvedGallons / allGallons) * 100) : null,
    variance: varianceToTarget(actualPct, policy.targets.onNetworkPct, "floor"),
  };

  // ── avoided-state gallons: one count per calendar month, against a per-month ceiling ─────────
  const byMonth = new Map<string, number>();
  for (const l of fuel) {
    if (l.tranDate == null || !isAvoidedState(l)) continue;
    const key = l.tranDate.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + l.gallons);
  }
  const avoidedStateByMonth: MonthGrade[] = monthsInWindow(window).map((month) => {
    const { start, end } = monthBounds(month);
    const gallons = byMonth.get(month) ?? 0;
    return {
      month,
      gallons,
      partial: window.from > start || window.to < end,
      variance: varianceToTarget(gallons, policy.targets.avoidedStateGal, "ceiling"),
    };
  });

  return {
    onNetwork,
    avoidedStateByMonth,
    discountCaptureTargetPct: policy.targets.discountCapturePct,
  };
}
