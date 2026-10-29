import type { Finding, PlacardOutput, TraceNode } from "../types.js";
import type { Resolved } from "./computeSupport.js";

/**
 * Two exceptions of domestic highway transport the ladder did not know (TWO-CLICK-READER-PLAN TC1.2, D-TC9; E2, E3).
 *
 * §173.150(f)(2): "The requirements in this subchapter do not apply to a material classed as a combustible liquid in a
 * non-bulk packaging unless the combustible liquid is a hazardous substance, a hazardous waste, or a marine
 * pollutant" — and (f)(3)(iv) keeps placarding for such a liquid in BULK packagings only. So a non-bulk line placarded
 * COMBUSTIBLE (NA1993 "Comb liq", or a Class 3 the shipper reclassed under (f)(1)) takes no placard and is not
 * hazardous material for the §172.504(c) aggregate, whatever else it is. Until 0.26.0 2,000 lb of it in drums in a
 * van required COMBUSTIBLE and counted toward 1,001 lb. Bulk combustible is unchanged.
 *
 * §172.504(f)(9): "For Class 9, a CLASS 9 placard is not required for domestic transportation … However, a bulk
 * packaging must be marked with the appropriate identification number on a CLASS 9 placard, an orange panel, or a
 * white square-on-point display configuration as required by subpart D." The waiver is for EVERY packaging, bulk
 * included — D-TC9 said "non-bulk", and the paragraph does not. The placard moves from required to permitted; the line
 * stays resolved, so a bulk line's ID number is still required and finds its carrier as any number whose placard is
 * not displayed: an orange panel or a white square-on-point. Its weight stays in the §172.504(c) aggregate: the waiver
 * is of the CLASS 9 placard, not of Class 9's being Table 2 material, so 2,000 lb of it beside 500 lb of paint still
 * requires FLAMMABLE — the reading that never under-placards.
 *
 * The engine evaluates US highway transport only (the vessel leg changes marks, never placards), so both apply always.
 */
export const COMBUSTIBLE_PLACARD = "COMBUSTIBLE";
export const CLASS_9_PLACARD = "CLASS_9";

/** The resolved lines with the §173.150(f)(2) non-bulk combustible liquids taken out — out of the whole ladder. */
export function exceptNonBulkCombustible(
  table2: Resolved[],
  isBulk: (r: Resolved) => boolean,
  findings: Finding[],
  trace: TraceNode[],
): Resolved[] {
  const excepted = table2.filter((r) => r.placard === COMBUSTIBLE_PLACARD && !isBulk(r));
  if (excepted.length === 0) return table2;
  trace.push({ ruleId: "combustible_non_bulk_excepted", fired: true, inputs: { lines: excepted.map((r) => r.line.hmtRef) }, citations: [{ cfr: "49 CFR 173.150(f)(2)" }] });
  findings.push({
    ruleId: "combustible_non_bulk_not_regulated",
    tier: "info",
    message:
      `${excepted.length} line(s) are a combustible liquid in non-bulk packaging, which the hazardous materials regulations do not apply to on the highway ` +
      "(§173.150(f)(2)) — no placard, and not counted toward the 1,001-lb aggregate. In bulk packaging the same liquid would placard COMBUSTIBLE.",
    citations: [{ cfr: "49 CFR 173.150(f)(2)" }],
    evidence: { lines: excepted.map((r) => r.line.hmtRef) },
  });
  return table2.filter((r) => !excepted.includes(r));
}

/** §172.504(f)(9): CLASS 9 leaves the required placards for the permitted ones, with a finding that says why. */
export function exceptClass9Placard(placards: PlacardOutput, findings: Finding[], trace: TraceNode[]): void {
  const at = placards.required.findIndex((p) => p.placard === CLASS_9_PLACARD);
  if (at < 0) return;
  trace.push({ ruleId: "class_9_placard_not_required", fired: true, inputs: {}, citations: [{ cfr: "49 CFR 172.504(f)(9)" }] });
  placards.required.splice(at, 1);
  if (!placards.permitted.some((p) => p.placard === CLASS_9_PLACARD)) {
    placards.permitted.push({ placard: CLASS_9_PLACARD, because: [{ cfr: "49 CFR 172.504(f)(9)" }, { cfr: "49 CFR 172.502(c)" }] });
  }
  findings.push({
    ruleId: "class_9_placard_not_required",
    tier: "info",
    message:
      "A CLASS 9 placard is not required in domestic transportation (§172.504(f)(9)); it may be displayed. " +
      "A bulk packaging of Class 9 material still shows its identification number — on a CLASS 9 placard, an orange panel or a white square-on-point.",
    citations: [{ cfr: "49 CFR 172.504(f)(9)" }],
    evidence: {},
  });
}
