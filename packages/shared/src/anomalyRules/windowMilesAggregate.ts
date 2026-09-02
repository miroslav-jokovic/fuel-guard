import { robustWindowMiles, type WindowMilesResult, type WindowOdoRow } from "./learning.js";

/**
 * FUEL-T3b — the seam that lets `robustWindowMiles` run on a DATABASE AGGREGATE instead of on rows,
 * without a single one of its constants moving into SQL.
 *
 * ── THE QUESTION T3b WAS ASKED ─────────────────────────────────────────────────────────────────
 * The Fuel Log's "total miles" tile is the per-truck odometer span summed across the fleet, and it is
 * computed by paging every matching fill into the browser. FUEL-T3a moved the four purely additive
 * tiles into SQL; this one could not follow, because 0252's D-AG1 says **"THIS SUMS. IT DOES NOT
 * DERIVE"** — and `robustWindowMiles` derives. It prefers the OBD span, falls back to the entered span
 * only when that span never steps backwards by more than a tolerance, and returns **null rather than
 * 0** for a non-advancing window, which its own header calls the single most important guard it makes.
 * Re-expressing any of that in SQL would put a second copy of a rule where no unit test can reach it.
 *
 * ── THE ANSWER: YES, AND THE TRICK IS THAT SQL RETURNS A MEASUREMENT, NOT A VERDICT ────────────
 * Every constant in `robustWindowMiles` is applied to a quantity that SQL can compute *without
 * knowing the constant*:
 *
 *   | The judgement                            | What SQL returns instead        | Who compares |
 *   |------------------------------------------|---------------------------------|--------------|
 *   | `span > MIN_WINDOW_ADVANCE_MI`           | the span                        | TypeScript   |
 *   | `obd.length >= 2`                        | the count                       | TypeScript   |
 *   | monotonic within ±1 (`v >= prev - 1`)    | **the worst backward step**     | TypeScript   |
 *
 * The third row is the whole finding. "Is this sequence monotonic within one mile" looks like it needs
 * the tolerance in SQL, but it does not: the largest backward step is `min(v - lag(v))` over the
 * ordered readings — a plain window aggregate with no threshold in it — and TypeScript then asks
 * whether that step is within its own tolerance. A measurement crosses the boundary; the judgement
 * never does.
 *
 * So this file holds the SAME decision as `robustWindowMiles`, expressed over aggregates, and
 * `windowMilesAggregate.test.ts` asserts the two agree on generated row sets rather than on a handful
 * of hand-picked ones. If they ever diverge, that test fails and this seam is what gets deleted —
 * the row-based function stays the definition.
 */

/** Everything SQL must return, per vehicle, for the decision below. No thresholds, only measurements. */
export interface WindowOdoAggregate {
  /** Readings whose `samsara_odometer_source` is 'obd' and whose odometer is not null. */
  obdCount: number;
  obdMin: number | null;
  obdMax: number | null;
  /** Readings with a non-null driver-entered odometer. */
  enteredCount: number;
  enteredMin: number | null;
  enteredMax: number | null;
  /**
   * The most negative step between consecutive non-null entered readings, oldest→newest; 0 when the
   * sequence never decreases, null when there are fewer than two readings to step between. This is the
   * measurement that replaces the monotonic test — see the header.
   */
  enteredWorstStep: number | null;
}

/**
 * The tolerances, kept here because here is where they already live. `robustWindowMiles` uses a bare
 * `1` for both, and its comment ties them together deliberately: the span must advance by more than the
 * same amount that a backward step is forgiven for, or "did not move" and "moved slightly backwards"
 * would be judged on different scales.
 */
const MIN_WINDOW_ADVANCE_MI = 1;
const BACKWARD_STEP_TOLERANCE_MI = 1;

const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/**
 * `robustWindowMiles`, over a SQL aggregate. Every branch below mirrors one in the row-based version;
 * the parity test is what holds them together.
 */
export function windowMilesFromAggregate(agg: WindowOdoAggregate): WindowMilesResult {
  if (agg.obdCount >= 2 && finite(agg.obdMin) && finite(agg.obdMax)) {
    // OBD is authoritative when present: use its span, or suppress if it did not advance. Do NOT fall
    // through to the noisier entered span when the clean source says the truck did not move.
    const span = agg.obdMax - agg.obdMin;
    return span > MIN_WINDOW_ADVANCE_MI ? { miles: span, basis: "samsara_obd" } : { miles: null, basis: "none" };
  }

  if (agg.enteredCount >= 2 && finite(agg.enteredMin) && finite(agg.enteredMax)) {
    // The monotonic check, done on the measurement SQL returned rather than on the sequence.
    const monotonic = finite(agg.enteredWorstStep) && agg.enteredWorstStep >= -BACKWARD_STEP_TOLERANCE_MI;
    const span = agg.enteredMax - agg.enteredMin;
    if (monotonic && span > MIN_WINDOW_ADVANCE_MI) return { miles: span, basis: "entered" };
  }
  return { miles: null, basis: "none" };
}

/**
 * The aggregate SQL is expected to produce, computed from rows — the reference implementation.
 *
 * This exists so the parity test can drive BOTH sides from one fixture: rows go through
 * `robustWindowMiles`, and the same rows go through here and then `windowMilesFromAggregate`. It also
 * documents, executably, exactly what the SQL has to compute, which is what the matrix asserts against.
 */
export function aggregateWindowOdo(rowsOldestFirst: readonly WindowOdoRow[]): WindowOdoAggregate {
  const obd = rowsOldestFirst
    .filter((r) => r.samsaraSource === "obd" && finite(r.samsaraOdometer))
    .map((r) => r.samsaraOdometer as number);
  const entered = rowsOldestFirst.map((r) => r.enteredOdometer).filter(finite);

  let worst: number | null = null;
  for (let i = 1; i < entered.length; i++) {
    const step = entered[i]! - entered[i - 1]!;
    worst = worst == null ? step : Math.min(worst, step);
  }
  // A sequence of one has no step to measure. A sequence that only ever rises has a worst step that is
  // positive — clamped to 0 so "never went backwards" reads the same whatever the climb looked like.
  if (worst != null && worst > 0) worst = 0;

  return {
    obdCount: obd.length,
    obdMin: obd.length ? Math.min(...obd) : null,
    obdMax: obd.length ? Math.max(...obd) : null,
    enteredCount: entered.length,
    enteredMin: entered.length ? Math.min(...entered) : null,
    enteredMax: entered.length ? Math.max(...entered) : null,
    enteredWorstStep: worst,
  };
}

/** Convenience for the parity test and for callers that still hold rows. */
export function windowMilesViaAggregate(rowsOldestFirst: readonly WindowOdoRow[]): WindowMilesResult {
  return windowMilesFromAggregate(aggregateWindowOdo(rowsOldestFirst));
}

export { robustWindowMiles };
