/**
 * The §172.203 additional-entry rules of the printed-paper audit: RQ and Limited Quantity (Marine
 * Pollutant, with its exceptions, is paperMarinePollutant.ts). Each requirement is read from the dataset on
 * the run — Appendix A (`hazSubstances`, RQ in lb and kg), HMT column 8A (`exceptionsRef`) — and a dataset
 * that does not carry the table answers `requirement_not_in_dataset`, never a guess.
 */
import type { PaperRuleResult } from "./paperTypes.js";
import { layoutDescription } from "./paperDescriptionText.js";
import {
  LQ_RX,
  blank,
  declaresLimitedQuantity,
  entryNames,
  gated,
  lineLabel,
  make,
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
 * Where the Limited Quantity words stand in the printed description: §172.203(b) wants them "following the
 * basic description". null when there is no description text, or its basic description cannot be laid out
 * — the position is then simply not verified.
 */
function lqPosition(line: LineCtx["printed"]): "following" | "before" | "outside" | null {
  if (blank(line.descriptionText)) return null;
  const layout = layoutDescription(line);
  if (layout.kind !== "in_sequence") return null;
  const at = [...line.descriptionText!.matchAll(new RegExp(LQ_RX.source, "gi"))].map((m) => m.index);
  if (at.length === 0) return "outside";
  return at.some((i) => i >= layout.end) ? "following" : "before";
}

/**
 * paper_lq — §172.203(b): "the description for a material offered for transportation as "limited
 * quantity," as authorized by this subchapter, must include the words "Limited Quantity" or "Ltd Qty"
 * following the basic description." The words must be there; they are only good where the HMT authorises
 * an exception at all — column 8A names a §173 section (the same column `verifyLqClaim` reads before it
 * lets LQ lift a placard); and, when the printed description is supplied, they must stand after it. With
 * only the reader's separate fields the words are accepted from the marks and `positionVerified` says the
 * position was not checked. The per-package caps stay with the placard path.
 */
export function paperLq(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_lq", ctx.index);
  const g = gated(ctx, r, ["marks", "psn", "packaging", "descriptionText"]);
  if (g) return g;
  const label = lineLabel(ctx);
  if (!declaresLimitedQuantity(ctx.printed) && !LQ_RX.test(ctx.printed.descriptionText ?? "")) {
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
  const position = lqPosition(ctx.printed);
  const facts = { lineLabel: label, exceptionsRef: pgRow.exceptionsRef };
  if (position === "before") return r("fail", "lq_not_following", facts);
  if (position === "outside") return r("cannot_tell", "lq_outside_description", facts);
  return r("pass", "authorised", { ...facts, positionVerified: position === "following" });
}

