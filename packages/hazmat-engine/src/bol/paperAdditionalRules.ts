/**
 * The §172.203 additional-entry rules of the printed-paper audit: RQ and Limited Quantity (Marine
 * Pollutant, with its exceptions, is paperMarinePollutant.ts). Each requirement is read from the dataset on
 * the run — Appendix A (`hazSubstances`, RQ in lb and kg), HMT column 8A (`exceptionsRef`) — and a dataset
 * that does not carry the table answers `requirement_not_in_dataset`, never a guess.
 */
import type { PaperRuleResult } from "./paperTypes.js";
import { matchAppendixNames, type Substance } from "../appendixNameMatch.js";
import { layoutDescription } from "./paperDescriptionText.js";
import {
  LQ_RX,
  blank,
  declaresLimitedQuantity,
  entryNames,
  gated,
  lineLabel,
  make,
  norm,
  printedConcentration,
  printsRq,
  rowOf,
  technicalComponents,
  technicalNameText,
  type LineCtx,
} from "./paperSupport.js";

/**
 * Per-package CONTENTS by mass, in the unit printed — or why it cannot be had. Never converts. The description's
 * own quantity by mass first; else the line's NET weight column (reader profile 1.5.0), which is the contents'
 * mass by definition. A gross weight is not: it carries the packaging (see `perPackageGrossLb`).
 */
function perPackageMass(ctx: LineCtx): { value: number; unit: "lb" | "kg"; basis: "quantity" | "net_weight" } | { reason: string } {
  const unit = ctx.resolved.quantityUnit;
  const { value } = ctx.printed.quantity;
  const count = ctx.printed.packageCount;
  if (count == null || count < 1) return { reason: "package_quantity_unknown" };
  if ((unit === "lb" || unit === "kg") && value != null) return { value: value / count, unit, basis: "quantity" };
  const net = ctx.printed.netWeightLb;
  if (net != null && net > 0) return { value: net / count, unit: "lb", basis: "net_weight" };
  // Only a printed volume is "by volume". No unit — no net quantity printed, or a unit the reader could not
  // name — said "the BOL gives the amount by volume" on every line that prints only a gross weight
  // (production read 76979453, UN3266, 2026-10-19); the honest answer there is that the package's
  // content is not shown.
  if (unit === "gal" || unit === "L") return { reason: "quantity_not_by_mass" };
  return { reason: "package_quantity_unknown" };
}

/**
 * The gross weight per package, in pounds: an UPPER bound on what it holds (contents + packaging), so it can
 * only ever clear a line — a package that weighs less than the RQ in all cannot hold the RQ. Null when unknown.
 */
function perPackageGrossLb(ctx: LineCtx): number | null {
  const { grossWeightLb: gross, packageCount: count } = ctx.printed;
  return gross != null && gross > 0 && count != null && count >= 1 ? gross / count : null;
}

const rqIn = (s: Substance, unit: "lb" | "kg"): number | undefined => (unit === "lb" ? s.rqPounds : s.rqKg);

/**
 * paper_rq — §172.203(c): "RQ" when a package holds at least the reportable quantity of an Appendix A
 * hazardous substance. Matched by name, as `validateBol` matches it (petroleum fuels are not listed, so
 * RQ never fires for them — docs/17 A.8).
 *
 * How much of the substance a package holds: its contents by mass (`perPackageMass` — the description's
 * quantity, else the net weight column) times the share of it. A NEAT material (the row's own name is listed)
 * is all substance unless the cell prints a concentration; a SOLUTION or a single named component is the
 * concentration the description cell prints ("CAUSTIC SODA 50%", `printedConcentration`, engine 0.20.0).
 *
 * Which way each answer may go. A package whose contents — or, failing those, whose gross weight — is under the
 * RQ is cleared: it cannot hold that much of anything. A share at or over the RQ fails: RQ is owed, and the
 * finding quotes the mass and the percentage it rests on. A share UNDER the RQ is not cleared: §171.8 judges
 * a mixture's concentration by weight and a paper's "93%" does not say by what, so a reading that would let
 * RQ go unprinted waits for a person. Production read 350d2f27 (Mayo Products BOL 14182) is the case: 8 totes
 * of 3,600 lb at 50 % sodium hydroxide (1,800 lb each) and 2 of 3,250 lb at 93 % sulfuric acid (≈3,020 lb),
 * against 1,000 lb RQs, printing RQ on neither.
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

  const { neat, mixture } = matchAppendixNames(entryNames(row.entry), table);
  // A solution of a listed substance is judged like a component named in the technical name: it can be
  // cleared by the package's whole mass, never failed without a concentration (appendixNameMatch.ts).
  const named = table.filter((h) => technicalComponents(ctx.printed).includes(h.nameNormalized));
  const components = neat.length ? [] : [...new Set([...mixture, ...named])];
  const listed = neat.length ? neat : components;
  if (listed.length === 0) {
    if (technicalNameText(ctx.printed) == null) {
      if (!Array.isArray(row.entry.symbols)) return r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "HMT column 1 symbols" });
      if (row.entry.symbols.includes("G")) return r("cannot_tell", "technical_name_not_printed", { lineLabel: label });
    }
    return r("pass", "not_listed", { lineLabel: label });
  }

  const substance = listed.reduce((a, b) => ((rqIn(b, "lb") ?? Infinity) < (rqIn(a, "lb") ?? Infinity) ? b : a));
  const base = { lineLabel: label, substance: substance.name ?? substance.nameNormalized };
  const mass = perPackageMass(ctx);
  if ("reason" in mass) {
    const g2 = gated(ctx, r, ["grossWeightLb"]);
    const gross = g2 ? null : perPackageGrossLb(ctx);
    const rqLb = rqIn(substance, "lb");
    if (gross != null && rqLb != null && gross < rqLb) return r("pass", "below_rq", { ...base, rq: rqLb, perPackage: gross, unit: "lb", basis: "gross_weight" });
    return r("cannot_tell", mass.reason, base);
  }
  if (mass.basis === "net_weight") {
    const g2 = gated(ctx, r, ["netWeightLb"]);
    if (g2) return g2;
  }
  const rq = rqIn(substance, mass.unit);
  if (rq == null) return r("cannot_tell", "requirement_not_in_dataset", { ...base, needs: `Appendix A RQ in ${mass.unit}` });
  const facts = { ...base, rq, perPackage: mass.value, unit: mass.unit, basis: mass.basis };
  if (mass.value < rq) return r("pass", "below_rq", facts);

  // The package holds the RQ or more. How much of it is the substance: the printed concentration, read from the
  // description cell — so the cell must be confirmed, or a percentage one reader left out reads as "none".
  const g3 = gated(ctx, r, ["descriptionText"]);
  if (g3) return g3;
  const pct = neat.length || listed.length === 1 ? printedConcentration(ctx.printed) : null;
  const share = pct ?? (neat.length ? 100 : null);
  if (share == null) return r("cannot_tell", "concentration_unknown", facts);
  const held = (mass.value * share) / 100;
  const withShare = { ...facts, concentrationPct: share, substancePerPackage: Math.round(held * 100) / 100 };
  return held >= rq ? r("fail", "rq_not_printed", withShare) : r("cannot_tell", "concentration_basis_unknown", withShare);
}

/** The text with every occurrence of the row's names blanked out, keeping its length so positions still line up. */
function withoutNames(text: string, names: readonly string[]): string {
  let out = text;
  for (const n of names) {
    const rx = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"), "gi");
    out = out.replace(rx, (m) => " ".repeat(m.length));
  }
  return out;
}

/**
 * Where the Limited Quantity words stand in the printed description: §172.203(b) wants them "following the
 * basic description". null when there is no description text, or its basic description cannot be laid out
 * — the position is then simply not verified.
 */
function lqPosition(line: LineCtx["printed"], names: readonly string[]): "following" | "before" | "outside" | null {
  if (blank(line.descriptionText)) return null;
  const layout = layoutDescription(line);
  if (layout.kind !== "in_sequence") return null;
  const at = [...withoutNames(line.descriptionText!, names).matchAll(new RegExp(LQ_RX.source, "gi"))].map((m) => m.index);
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
  const notPrinted = () =>
    ctx.resolved.claimedLimitedQuantity === true
      ? r("fail", "claimed_not_printed", { lineLabel: label })
      : r("pass", "not_claimed", { lineLabel: label });
  const p = ctx.printed;
  if (!declaresLimitedQuantity(p) && !LQ_RX.test(p.descriptionText ?? "")) return notPrinted();
  const row = rowOf(ctx);
  // The words may be the row's own name: UN2910 is "Radioactive material, excepted package-limited quantity of
  // material", and every correct UN2910 paper read as a Limited Quantity claim (the RC5 golden census). Only the
  // words printed beside the name are a claim.
  const names = row ? entryNames(row.entry) : [];
  const besideName = (t: string | null | undefined) => LQ_RX.test(withoutNames(t ?? "", names));
  if (row && !p.marks.some((m) => LQ_RX.test(m)) && !besideName(p.psn) && !besideName(p.packaging) && !besideName(p.descriptionText)) return notPrinted();
  if (!row || row.pg === undefined) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  const pgRow = row.entry.pgRows.find((x) => x.pg === row.pg);
  if (!pgRow || !("exceptionsRef" in pgRow)) {
    return r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "HMT column 8A (exceptions)" });
  }
  // Rows the paper cannot tell apart — one id, name, class and PG, told apart by an italic qualifier it never prints —
  // may still differ in column 8A: UN1738 "Benzyl chloride" is two rows of the 2026.12.0 cut, one excepting under
  // §173.153 and one excepting nothing, and the table matcher names the first. The answer holds only if every one
  // of them gives it (the RC5 golden census, READER-CORRECTNESS-PLAN).
  const twins = ctx.ds.entries
    .filter((e) => e.idPrefix === row.entry.idPrefix && e.idNumber === row.entry.idNumber && e.hazardClass === row.entry.hazardClass &&
      norm(e.psnPrinted) === norm(row.entry.psnPrinted) && (e.subsidiaryClasses ?? []).join() === (row.entry.subsidiaryClasses ?? []).join())
    .flatMap((e) => e.pgRows.filter((x) => x.pg === row.pg));
  if (twins.some((x) => (x.exceptionsRef == null) !== (pgRow.exceptionsRef == null))) {
    return r("cannot_tell", "rows_differ", { lineLabel: label, requiredPsn: row.entry.psnPrinted });
  }
  if (pgRow.exceptionsRef == null) return r("fail", "not_authorised", { lineLabel: label, requiredPsn: row.entry.psnPrinted });
  const position = lqPosition(ctx.printed, names);
  const facts = { lineLabel: label, exceptionsRef: pgRow.exceptionsRef };
  if (position === "before") return r("fail", "lq_not_following", facts);
  if (position === "outside") return r("cannot_tell", "lq_outside_description", facts);
  return r("pass", "authorised", { ...facts, positionVerified: position === "following" });
}

