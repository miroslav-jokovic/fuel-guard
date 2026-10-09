/**
 * The basic-description rules of the printed-paper audit (§5.1): what §172.202(a)–(b) and §172.201(a)(1)
 * require of each printed line, quoted from eCFR's text of 2026-10-09. Material-specific requirements
 * (PSN, class, subsidiaries, PG) come from the row the line resolved to; the dataset is never restated.
 * §172.202(a)'s paragraphs, as eCFR numbers them: (1) identification number, (2) proper shipping name,
 * (3) hazard class, (4) packing group, (5) total quantity, (7) number and type of packages.
 */
import type { PaperRuleResult } from "./paperTypes.js";
import { blank, classMayBeOmitted, formatClass, gated, lineLabel, make, requiredPgs, rowOf, type LineCtx } from "./paperSupport.js";
import { layoutDescription } from "./paperDescriptionText.js";

/**
 * paper_sequence — §172.202(a)(1)–(4) and (b): id, PSN, class and PG are all printed, and — when the line's
 * printed description is supplied (`descriptionText`) — "shown in sequence with no additional information
 * interspersed" (§172.202(b); the exceptions it allows are applied in paperDescriptionText.ts). Without
 * the text the order is invisible and the pass says so (`orderVerified: false`).
 */
export function paperSequence(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_sequence", ctx.index);
  const g = gated(ctx, r, ["idText", "psn", "hazardClass", "pg", "descriptionText"]);
  if (g) return g;
  const p = ctx.printed;
  const row = rowOf(ctx);
  const missing: string[] = [];
  if (blank(p.idText)) missing.push("id");
  if (blank(p.psn)) missing.push("psn");
  if (blank(p.hazardClass) && !(row && classMayBeOmitted(row.entry))) missing.push("class");
  let pgUnknown = false;
  if (p.pg == null) {
    if (row) {
      if (requiredPgs(row).some((pg) => pg != null)) missing.push("pg");
    } else pgUnknown = true;
  }
  const label = lineLabel(ctx);
  if (missing.length) return r("fail", "elements_missing", { lineLabel: label, missing });
  if (pgUnknown) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  const printed = [p.idText, p.psn, p.hazardClass, p.pg].filter((s): s is string => !blank(s)).map((s) => s.trim()).join(", ");
  if (blank(p.descriptionText)) return r("pass", "all_elements_printed", { lineLabel: label, printed, orderVerified: false });
  const layout = layoutDescription(p);
  const facts = { lineLabel: label, printed, descriptionText: p.descriptionText!.trim() };
  switch (layout.kind) {
    case "in_sequence":
      return r("pass", "in_sequence", { ...facts, orderVerified: true });
    case "out_of_order":
      return r("fail", "out_of_order", facts);
    case "interspersed":
      return r("fail", "interspersed", { ...facts, interspersed: layout.text });
    default:
      return r("cannot_tell", "description_text_unmatched", facts);
  }
}

/**
 * paper_psn_matches_hmt — §172.202(a)(2): "The proper shipping name prescribed for the material in Column
 * (2) of the § 172.101 table". The comparison itself is the resolver's: `resolveHmtLine` matches the
 * printed name within the id block using only the variations §172.101(c)(1)–(2) permit (case,
 * singular/plural, punctuation, "n.o.s." spellings, and a trailing technical-name parenthetical on G
 * entries — `normalizePsnForMatch`, PSN_NORMALIZER_VERSION). A resolved line, or a failure that happens
 * after the name step, is a match; `psn_no_match` is a mismatch.
 */
export function paperPsnMatchesHmt(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_psn_matches_hmt", ctx.index);
  const g = gated(ctx, r, ["psn"]);
  if (g) return g;
  const res = ctx.resolved.resolution;
  const row = rowOf(ctx);
  const label = lineLabel(ctx);
  const printedPsn = ctx.printed.psn?.trim() ?? null;
  if (res && !res.ok && res.reason === "psn_no_match" && printedPsn) {
    return r("fail", "psn_not_in_hmt", { lineLabel: label, printedPsn, candidatePsns: (res.candidates ?? []).map((c) => c.psn) });
  }
  if (!row) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  if (!printedPsn) return r("fail", "psn_missing", { lineLabel: label, requiredPsn: row.entry.psnPrinted });
  return r("pass", "matched", { lineLabel: label, printedPsn, requiredPsn: row.entry.psnPrinted });
}

/**
 * paper_class_pg_match — §172.202(a)(3) "The hazard class or division number prescribed for the material,
 * as shown in Column (3)" and (a)(4) "The packing group in Roman numerals, as designated … in Column (5)":
 * class (with subsidiaries) and PG equal the row's. The class comparison is the resolver's
 * (`class_mismatch`, which also honours the offeror's §173.150(f) combustible election); the PG
 * comparison is set membership against the row's own PG column.
 */
export function paperClassPgMatch(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_class_pg_match", ctx.index);
  const g = gated(ctx, r, ["hazardClass", "pg"]);
  if (g) return g;
  const row = rowOf(ctx);
  const label = lineLabel(ctx);
  if (!row) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  const p = ctx.printed;
  const res = ctx.resolved.resolution;
  let classProblem: "missing" | "differs" | null = null;
  if (blank(p.hazardClass)) classProblem = classMayBeOmitted(row.entry) ? null : "missing";
  else if (res && !res.ok && res.reason === "class_mismatch") classProblem = "differs";

  const allowed = requiredPgs(row);
  let pgProblem: "missing" | "differs" | "not_allowed" | null = null;
  if (allowed.every((pg) => pg == null)) pgProblem = p.pg != null ? "not_allowed" : null;
  else if (p.pg == null) pgProblem = "missing";
  else if (!allowed.includes(p.pg)) pgProblem = "differs";

  const facts = {
    lineLabel: label,
    printedClass: p.hazardClass?.trim() || null,
    printedPg: p.pg,
    requiredClass: formatClass(row.entry),
    requiredPg: allowed.length === 1 ? (allowed[0] ?? null) : allowed.filter((pg): pg is "I" | "II" | "III" => pg != null),
    classProblem,
    pgProblem,
  };
  return classProblem || pgProblem ? r("fail", "class_or_pg_wrong", facts) : r("pass", "matches", facts);
}

/** §172.202(a)(5)(iii)(A)'s examples are "1 cargo tank" and "2 IBCs"; these are the bulk packagings by name. */
const BULK_NAME = /\b(cargo\s+tanks?|ibcs?|intermediate\s+bulk\s+containers?|portable\s+tanks?|tank\s+cars?)\b/i;
const CYLINDER_NAME = /\bcyl(?:inders?\b|s?\.|s?\b)/i;
/** A count printed at the head of the packaging phrase ("12 drums", "1 cargo tank"). */
function leadingCount(packaging: string | null): number | null {
  const m = /^\s*(\d+)\b/.exec(packaging ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * paper_quantity_present — §172.202(a)(5): "the total quantity of hazardous materials covered by the
 * description must be indicated (by mass or volume …) and must include an indication of the applicable
 * unit of measurement". (a)(5)(iii) excepts "(A) Bulk packages, provided some indication of the total
 * quantity is shown, for example, "1 cargo tank" or "2 IBCs."", "(B) Cylinders, provided some indication
 * of the total quantity is shown, for example, "10 cylinders."" and "(C) Packages containing only
 * residue." Bulk is the caller's derivation (`packagingKind`) or a bulk packaging named in the phrase.
 */
export function paperQuantityPresent(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_quantity_present", ctx.index);
  const g = gated(ctx, r, ["quantity", "packaging", "packageCount", "marks"]);
  if (g) return g;
  const p = ctx.printed;
  const label = lineLabel(ctx);
  const { value, unit } = p.quantity;
  if (value != null && value > 0 && !blank(unit)) return r("pass", "printed", { lineLabel: label, value, unit: unit!.trim() });
  const counted = (p.packageCount ?? leadingCount(p.packaging) ?? 0) >= 1 && !blank(p.packaging);
  if (counted && (ctx.resolved.packagingKind === "bulk" || BULK_NAME.test(p.packaging!))) {
    return r("pass", "bulk_package_count", { lineLabel: label, packaging: p.packaging!.trim() });
  }
  if (counted && CYLINDER_NAME.test(p.packaging!)) return r("pass", "cylinder_count", { lineLabel: label, packaging: p.packaging!.trim() });
  if ([...p.marks, p.psn ?? ""].some((s) => /\bresidue\b/i.test(s))) return r("pass", "residue", { lineLabel: label });
  if (value != null && blank(unit)) return r("fail", "unit_missing", { lineLabel: label, value });
  return r("fail", "missing", { lineLabel: label });
}

/**
 * paper_package_count — §172.202(a)(7): "The number and type of packages must be indicated. The type of
 * packages must be indicated by description of the package (for example, "12 drums")." (a)(7) carries no
 * residue or bulk exception, so "1 cargo tank" is how a bulk load meets it. The count is the reader's
 * `packageCount`, or the number heading the packaging phrase; the type is the phrase's words.
 */
export function paperPackageCount(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_package_count", ctx.index);
  const g = gated(ctx, r, ["packageCount", "packaging"]);
  if (g) return g;
  const p = ctx.printed;
  const label = lineLabel(ctx);
  const count = p.packageCount ?? leadingCount(p.packaging);
  const type = /[a-z]/i.test(p.packaging ?? "") ? p.packaging!.trim() : null;
  if (count != null && count >= 1 && type) return r("pass", "printed", { lineLabel: label, packageCount: count, packaging: type });
  if (type) return r("fail", "count_missing", { lineLabel: label, packaging: type });
  if (count != null && count >= 1) return r("fail", "type_missing", { lineLabel: label, packageCount: count });
  return r("fail", "missing", { lineLabel: label });
}

/**
 * paper_hm_column — §172.201(a)(1): "When a hazardous material and a material not subject to the
 * requirements of this subchapter are described on the same shipping paper", the hazmat entries "(i) Must
 * be entered first, or (ii) Must be entered in a color that clearly contrasts …, or (iii) Must be
 * identified by the entry of an "X" placed before the basic shipping description … in a column captioned
 * "HM." (The "X" may be replaced by "RQ," if appropriate.)" (i) is read from the caller's line order
 * (`hazmatEntriesFirst`); (iii) from the mark — though whether the column is CAPTIONED "HM" is not
 * transcribed, and the pass says so (`columnCaptionVerified: false`); (ii)'s colour is never read, so an
 * unidentified line on a mixed (or possibly mixed) paper is `cannot_tell`, never `fail`.
 */
export function paperHmColumn(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_hm_column", ctx.index);
  const g = gated(ctx, r, ["hmColumnMark"]);
  if (g) return g;
  const label = lineLabel(ctx);
  if (ctx.printed.hmColumnMark) return r("pass", "marked", { lineLabel: label, mark: ctx.printed.hmColumnMark, columnCaptionVerified: false });
  if (ctx.paper.mixedPaper === false) return r("pass", "not_mixed", { lineLabel: label });
  if (ctx.paper.mixedPaper === true && ctx.paper.hazmatEntriesFirst === true) return r("pass", "listed_first", { lineLabel: label });
  return r("cannot_tell", "identification_method_not_read", { lineLabel: label, mixedPaper: ctx.paper.mixedPaper ?? null });
}
