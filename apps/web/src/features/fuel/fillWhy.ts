import { explainCaseOutcome, formatRuleId, type FuelTransaction, type CaseLevel, type CaseSignal } from "@silvicom/shared";

/*
 * The Fills tab's "why" marker, moved out of `FillsTab.vue` unchanged (F02-F04 chunk 11b) so that file
 * could take the Amount column inside its 500-line budget. Pure: a row in, words out.
 */

/** WP2 "why" surface — sub-threshold signals persisted on the fill (case_signals) explained in plain
 *  language, so a clear fill with a fired-but-weak signal (e.g. a lone odometer regression) is visible. */
export function weakSignals(row: FuelTransaction): CaseSignal[] {
  if (row.has_anomaly) return []; // flagged fills explain themselves on the Alerts page
  // Q-FUI17 (0323): the weightless rules belong HERE and nowhere else. This panel exists for exactly
  // the fill that is clear and had something fire on it, which is the whole of what a weight-0 rule
  // ever produces — before the column they vanished at the moment they fired, so a reviewer looking
  // at an over-fuelled fill was told "no detection signals fired" about a rule that had.
  return [...(row.case_signals ?? []), ...(row.case_signals_unscored ?? [])] as CaseSignal[];
}
export function whyTitle(row: FuelTransaction): string {
  const sigs = weakSignals(row);
  const names = sigs.map((s) => formatRuleId(s.ruleId)).join(", ");
  return `${names}\n\n${explainCaseOutcome((row.case_level ?? "clear") as CaseLevel, Number(row.case_score ?? 0), sigs)}${gatesNote(row)}`;
}
/** WP6 — honest-absence note: which rule groups were INELIGIBLE for this fill and why. */
function gatesNote(row: FuelTransaction): string {
  const g = row.case_gates;
  if (!g?.ineligible?.length) return "";
  const why: string[] = [];
  if (g.tankSensor !== "reliable") why.push("tank sensor not learned-reliable");
  if (g.odoSource === "other") why.push("odometer cross-check is GPS-derived");
  if (g.fillSize === "too_small") why.push("fill too small for the sensor to read");
  return `\n\nChecks limited on this fill (${why.join("; ") || "confidence gates"}): ${g.ineligible.map((r) => formatRuleId(r)).join(", ")} did not run.`;
}
/** Show the marker when sub-threshold signals fired OR meaningful checks were gated off. */
export function hasWhy(row: FuelTransaction): boolean {
  return weakSignals(row).length > 0 || !!row.case_gates?.ineligible?.length;
}
