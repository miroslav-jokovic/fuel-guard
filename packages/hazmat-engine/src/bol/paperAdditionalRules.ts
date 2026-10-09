/**
 * The §172.203 additional-entry rules of the printed-paper audit: RQ, Limited Quantity, Marine Pollutant.
 * Each requirement is read from the dataset on the run — Appendix A (`hazSubstances`, RQ in lb and kg),
 * HMT column 8A (`exceptionsRef`), Appendix B (`marinePollutants`) and the SP 441 identity route — and a
 * dataset that does not carry the table answers `requirement_not_in_dataset`, never a guess.
 */
import { classifyMarinePollutantEntry } from "../placards/marinePollutant.js";
import type { PaperRuleResult } from "./paperTypes.js";
import {
  declaresLimitedQuantity,
  entryNames,
  gated,
  lineLabel,
  make,
  printsMarinePollutant,
  printsRq,
  rowOf,
  technicalComponents,
  technicalNameText,
  type LineCtx,
} from "./paperSupport.js";

type Substance = { name?: string; nameNormalized: string; rqPounds?: number; rqKg?: number };

/** Per-package quantity by mass, in the unit printed — or why it cannot be had. Never converts. */
function perPackageMass(ctx: LineCtx): { value: number; unit: "lb" | "kg" } | { reason: string } {
  const unit = ctx.resolved.quantityUnit;
  if (unit !== "lb" && unit !== "kg") return { reason: "quantity_not_by_mass" };
  const { value } = ctx.printed.quantity;
  const count = ctx.printed.packageCount;
  if (value == null || count == null || count < 1) return { reason: "package_quantity_unknown" };
  return { value: value / count, unit };
}

const rqIn = (s: Substance, unit: "lb" | "kg"): number | undefined => (unit === "lb" ? s.rqPounds : s.rqKg);

/**
 * paper_rq — §172.203(c): "RQ" when a package holds at least the reportable quantity of an Appendix A
 * hazardous substance. Matched by name, as `validateBol` matches it (petroleum fuels are not listed, so
 * RQ never fires for them — docs/17 A.8). A NEAT material (the row's own name is listed) is compared
 * directly. A listed COMPONENT named in a G entry's technical name can only be cleared: a package under
 * the component's RQ cannot hold that much of it, but over it the concentration decides, and no paper
 * states one.
 */
export function paperRq(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_rq", ctx.index);
  const g = gated(ctx, r, ["hmColumnMark", "marks", "psn", "technicalName", "quantity", "packageCount"]);
  if (g) return g;
  const label = lineLabel(ctx);
  const row = rowOf(ctx);
  if (!row) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  if (printsRq(ctx.printed)) return r("pass", "printed", { lineLabel: label });
  const table = ctx.ds.hazSubstances;
  if (table.length === 0) return r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "Appendix A to §172.101" });

  const names = entryNames(row.entry);
  const neat = table.filter((h) => names.includes(h.nameNormalized));
  const components = neat.length ? [] : table.filter((h) => technicalComponents(ctx.printed).includes(h.nameNormalized));
  const listed = neat.length ? neat : components;
  if (listed.length === 0) {
    if (technicalNameText(ctx.printed) == null) {
      if (!Array.isArray(row.entry.symbols)) return r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "HMT column 1 symbols" });
      if (row.entry.symbols.includes("G")) return r("cannot_tell", "technical_name_not_printed", { lineLabel: label });
    }
    return r("pass", "not_listed", { lineLabel: label });
  }

  const mass = perPackageMass(ctx);
  const substance = listed.reduce((a, b) => ((rqIn(b, "lb") ?? Infinity) < (rqIn(a, "lb") ?? Infinity) ? b : a));
  const base = { lineLabel: label, substance: substance.name ?? substance.nameNormalized };
  if ("reason" in mass) return r("cannot_tell", mass.reason, base);
  const rq = rqIn(substance, mass.unit);
  if (rq == null) return r("cannot_tell", "requirement_not_in_dataset", { ...base, needs: `Appendix A RQ in ${mass.unit}` });
  const facts = { ...base, rq, perPackage: mass.value, unit: mass.unit };
  if (mass.value < rq) return r("pass", "below_rq", facts);
  return neat.length ? r("fail", "rq_not_printed", facts) : r("cannot_tell", "concentration_unknown", facts);
}

/**
 * paper_lq — §172.203(b): a Limited Quantity line says so ("Limited Quantity" / "Ltd Qty"), and the words
 * are only good where the HMT authorises an exception at all — column 8A names a §173 section (the same
 * column `verifyLqClaim` reads before it lets LQ lift a placard). The per-package caps stay with the
 * placard path; this rule speaks only to the paper.
 */
export function paperLq(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_lq", ctx.index);
  const g = gated(ctx, r, ["marks", "psn", "packaging"]);
  if (g) return g;
  const label = lineLabel(ctx);
  if (!declaresLimitedQuantity(ctx.printed)) {
    return ctx.resolved.claimedLimitedQuantity === true
      ? r("fail", "claimed_not_printed", { lineLabel: label })
      : r("pass", "not_claimed", { lineLabel: label });
  }
  const row = rowOf(ctx);
  if (!row || row.pg === undefined) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  const pgRow = row.entry.pgRows.find((x) => x.pg === row.pg);
  if (!pgRow || !("exceptionsRef" in pgRow)) {
    return r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "HMT column 8A (exceptions)" });
  }
  if (pgRow.exceptionsRef == null) return r("fail", "not_authorised", { lineLabel: label, requiredPsn: row.entry.psnPrinted });
  return r("pass", "authorised", { lineLabel: label, exceptionsRef: pgRow.exceptionsRef });
}

/**
 * paper_marine_pollutant — §172.203(l): "Marine Pollutant" when the material is one AND the requirement
 * reaches this move. Listed = Appendix B by name (the row's, or a component in the technical name) or the
 * SP 441 route (`classifyMarinePollutantEntry`, the one definition the placard rule uses). Reach =
 * §171.4(c)(1): marine-pollutant requirements do not apply to NON-BULK packages moving only by highway,
 * so bulk, or any vessel leg, needs the words.
 */
export function paperMarinePollutant(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_marine_pollutant", ctx.index);
  const g = gated(ctx, r, ["marks", "psn", "technicalName"]);
  if (g) return g;
  const label = lineLabel(ctx);
  const row = rowOf(ctx);
  if (!row) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  if (printsMarinePollutant(ctx.printed)) return r("pass", "printed", { lineLabel: label });
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
  if (kind === "bulk" || vessel === true) return r("fail", "required_not_printed", facts);
  if (kind === "non_bulk" && vessel === false) return r("pass", "not_required_non_bulk_highway", facts);
  return r("cannot_tell", "applicability_unknown", facts);
}
