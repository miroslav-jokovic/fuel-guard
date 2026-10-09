/**
 * paper_marine_pollutant — §172.203(l)(2): "The words "Marine Pollutant" shall be entered in association
 * with the basic description for a material which is a marine pollutant." Quotes are eCFR's text of
 * 2026-10-09.
 *
 * LISTED = Appendix B by name (the row's, or a component in the technical name) or the SP 441 route
 * (`classifyMarinePollutantEntry`, the one definition the placard rule uses) — from the dataset on the run.
 *
 * Then the three exceptions that text gives, in this order:
 *  - §171.4(c)(1) / §172.203(l)(4): "Except when all or part of the transportation is by vessel, the
 *    requirements of this subchapter specific to marine pollutants do not apply to non-bulk packagings
 *    transported by motor vehicle, rail car or aircraft."
 *  - §172.203(l)(3): "Except for transportation by vessel, marine pollutants subject to the provisions of
 *    49 CFR 130.11 are excepted from the requirements of paragraph (l) of this section if a phrase
 *    indicating the material is an oil is placed in association with the basic description." The phrase is
 *    the word "oil", or one of the names §130.11(c) lets stand for it: "A material subject to the
 *    requirements of this part need not be specifically identified as oil when the shipment document
 *    accurately describes the material as: aviation fuel, diesel fuel, fuel oil, gasoline, jet fuel,
 *    kerosene, motor fuel, or petroleum." Whether the material is subject to Part 130 at all (§130.2) is
 *    the caller's fact (`subjectToPart130`), never assumed.
 *  - §171.4(c)(2): "Single or combination packagings containing a net quantity per single or inner
 *    packaging of 5 L or less for liquids or having a net mass of 5 kg or less for solids, are not subject
 *    to any other requirements of this subchapter … This exception does not apply to marine pollutants
 *    that are a hazardous waste or a hazardous substance." The per-package quantity is the printed total
 *    over the printed count; gallons and pounds convert by their exact definitions (1 gal = 3.785411784 L,
 *    1 lb = 0.45359237 kg). A package over the limit is read as one single packaging, because inner
 *    packagings are not on the paper — the residual case is a combination package whose inners are each
 *    under 5 L, which this rule would fail; recorded for the owner as part of Q-DR15's follow-up.
 */
import { classifyMarinePollutantEntry } from "../placards/marinePollutant.js";
import type { PaperRuleResult } from "./paperTypes.js";
import { gated, lineLabel, lineTexts, make, norm, printsMarinePollutant, printsRq, rowOf, technicalComponents, type LineCtx } from "./paperSupport.js";

const OIL_PHRASE = /\b(oil|aviation fuel|diesel fuel|fuel oil|gasoline|jet fuel|kerosene|motor fuel|petroleum)\b/i;
const TO_LITRES: Record<string, number> = { L: 1, gal: 3.785411784 };
const TO_KG: Record<string, number> = { kg: 1, lb: 0.45359237 };

/** Liquid or solid: the caller's, else the row's own name ("…, liquid, n.o.s."), else Class 3 (a liquid by §173.120). */
function stateOf(ctx: LineCtx, psn: string, hazardClass: string | null): "liquid" | "solid" | "gas" | null {
  if (ctx.resolved.physicalState) return ctx.resolved.physicalState;
  if (/\bliquids?\b/i.test(psn)) return "liquid";
  if (/\bsolids?\b/i.test(psn)) return "solid";
  return hazardClass === "3" ? "liquid" : null;
}

type Small = { excepted: true; perPackage: number; unit: "L" | "kg" } | { excepted: false; reason: string | null };

/** §171.4(c)(2) — null reason = the exception plainly does not apply; a reason = it might, and we cannot tell. */
function smallPackage(ctx: LineCtx, psn: string, hazardClass: string | null): Small {
  const isWaste = /\bwaste\b/i.test(psn) || lineTexts(ctx.printed).some((t) => /^\s*waste\b/i.test(t));
  if (isWaste || printsRq(ctx.printed)) return { excepted: false, reason: null };
  const unit = ctx.resolved.quantityUnit ?? null;
  const { value } = ctx.printed.quantity;
  const count = ctx.printed.packageCount;
  if (unit == null || value == null || count == null || count < 1) return { excepted: false, reason: "package_quantity_unknown" };
  const state = stateOf(ctx, psn, hazardClass);
  const litres = unit in TO_LITRES ? (value / count) * TO_LITRES[unit]! : null;
  const kilos = unit in TO_KG ? (value / count) * TO_KG[unit]! : null;
  const fits = state === "liquid" ? litres : state === "solid" ? kilos : null;
  if (fits == null) {
    const couldFit = (litres != null && litres <= 5) || (kilos != null && kilos <= 5);
    return { excepted: false, reason: couldFit ? "physical_state_unknown" : null };
  }
  if (fits > 5) return { excepted: false, reason: null };
  const listedHs = ctx.ds.hazSubstances.length === 0 || ctx.ds.hazSubstances.some((h) => norm(psn) === h.nameNormalized || technicalComponents(ctx.printed).includes(h.nameNormalized));
  if (listedHs) return { excepted: false, reason: "hazardous_substance_may_apply" };
  return { excepted: true, perPackage: Math.round(fits * 1000) / 1000, unit: state === "liquid" ? "L" : "kg" };
}

export function paperMarinePollutant(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_marine_pollutant", ctx.index);
  const g = gated(ctx, r, ["marks", "psn", "technicalName", "descriptionText", "quantity", "packageCount"]);
  if (g) return g;
  const label = lineLabel(ctx);
  const row = rowOf(ctx);
  if (!row) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  if (printsMarinePollutant(ctx.printed) || /\bmarine\s+pollutant\b/i.test(ctx.printed.descriptionText ?? "")) return r("pass", "printed", { lineLabel: label });
  const list = ctx.ds.marinePollutants;
  const byComponent = list.some((m) => technicalComponents(ctx.printed).includes(m.nameNormalized));
  const listed = classifyMarinePollutantEntry(row.entry, list).listed || byComponent;
  if (!listed) {
    return list.length === 0
      ? r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "Appendix B to §172.101" })
      : r("pass", "not_listed", { lineLabel: label });
  }
  const kind = ctx.resolved.packagingKind ?? null;
  const vessel = ctx.paper.vesselLeg ?? null;
  const facts = { lineLabel: label, requiredPsn: row.entry.psnPrinted, packagingKind: kind, vesselLeg: vessel };
  if (kind === "non_bulk" && vessel === false) return r("pass", "not_required_non_bulk_highway", facts);

  if (vessel !== true && lineTexts(ctx.printed).some((t) => OIL_PHRASE.test(t))) {
    if (vessel === false && ctx.resolved.subjectToPart130 === true) return r("pass", "excepted_oil_130_11", facts);
    if (ctx.resolved.subjectToPart130 !== false) return r("cannot_tell", "oil_exception_may_apply", facts);
  }
  if (kind !== "bulk") {
    const small = smallPackage(ctx, row.entry.psnPrinted, row.entry.hazardClass);
    if (small.excepted) return r("pass", "excepted_small_package_171_4_c2", { ...facts, perPackage: small.perPackage, unit: small.unit });
    if (small.reason) return r("cannot_tell", small.reason, facts);
  }
  if (kind === "bulk" || vessel === true) return r("fail", "required_not_printed", facts);
  return r("cannot_tell", "applicability_unknown", facts);
}
