/**
 * The fill-detection start date (D-CF9, Q-CF1 (a); migration 0439; F02-F04 PLAN.md chunk 7b).
 *
 * `organizations.detection_epoch` is set once, by `reset_fill_detection`, which also closes every open
 * case before it. From then on ONE rule holds everywhere: a fill before the start date raises no case
 * and shows no case. Scoring reads it (no case is written), the flag reconcile reads it (no red marker
 * in the Fuel Log), and every list of cases in the browser reads it (the Alerts page and the driver and
 * vehicle pages). It lives here once so those five cannot disagree.
 *
 * One exception: a case a person is INVESTIGATING stays visible whatever its date. The reset leaves such
 * cases open on purpose (0439), and hiding work in progress would lose it.
 *
 * Why scoring must read it at all: a closed case does not stop its fill raising a new one (0158: only
 * open and investigating cases block), and the boot rebuild re-scores 180 days of fills after every
 * deploy. Without this, the next deploy would re-open what the reset closed.
 *
 * Pure: no clock.
 */

/** True when the fill happened before the org's start date. No start date, or no fill time: false. */
export function beforeDetectionEpoch(fueledAt: string | null | undefined, epoch: string | null | undefined): boolean {
  if (!epoch || !fueledAt) return false;
  return Date.parse(fueledAt) < Date.parse(epoch);
}

/** Whether a case is shown and counted: on or after the start date, or being investigated. */
export function caseIsAfterReset(
  c: { fueled_at?: string | null; status: string },
  epoch: string | null | undefined,
): boolean {
  return c.status === "investigating" || !beforeDetectionEpoch(c.fueled_at, epoch);
}

/**
 * The same rule as a PostgREST `.or()` filter, for a query of `anomalies` (`fueled_at`) or of
 * `card_fraud_incidents` (`opened_at`: D-CF9 starts both at the same date, chunk 8c1); null when the org has
 * no start date (nothing to filter). The instant is normalised to UTC so the `+` of an offset never has
 * to survive the query string.
 */
export function detectionEpochOrFilter(epoch: string | null | undefined, column = "fueled_at"): string | null {
  if (!epoch) return null;
  return `${column}.gte.${new Date(epoch).toISOString()},status.eq.investigating`;
}
