/**
 * The basic-description rules of the printed-paper audit (§5.1): what §172.202(a) and §172.201(a)(1)
 * require of each printed line. Material-specific requirements (PSN, class, subsidiaries, PG, the G
 * symbol) come from the row the line resolved to; the dataset is never restated here.
 */
import type { PaperRuleResult } from "./paperTypes.js";
import {
  blank,
  classMayBeOmitted,
  formatClass,
  gated,
  lineLabel,
  make,
  requiredPgs,
  rowOf,
  technicalNameText,
  type LineCtx,
} from "./paperSupport.js";

/**
 * paper_sequence — §172.202(a), (b): id, PSN, class and PG are all printed. Whether they stand in ISHP
 * order is NOT checked: the reader's contract carries each element as its own field, not the printed
 * description, so order is invisible here and the pass says so (`orderVerified: false`).
 */
export function paperSequence(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_sequence", ctx.index);
  const g = gated(ctx, r, ["idText", "psn", "hazardClass", "pg"]);
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
  const printed = [p.idText, p.psn, p.hazardClass, p.pg].filter((s): s is string => !blank(s)).map((s) => s.trim());
  return r("pass", "all_elements_printed", { lineLabel: label, printed: printed.join(", "), orderVerified: false });
}

/**
 * paper_psn_matches_hmt — §172.202(a)(1): the printed PSN is the row's. The comparison itself is the
 * resolver's: `resolveHmtLine` matches the printed name within the id block using only the variations
 * §172.101(c)(1)–(2) permit (case, singular/plural, punctuation, "n.o.s." spellings, and a trailing
 * technical-name parenthetical on G entries — `normalizePsnForMatch`, PSN_NORMALIZER_VERSION). A resolved
 * line, or a failure that happens after the name step, is a match; `psn_no_match` is a mismatch.
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
 * paper_class_pg_match — §172.202(a)(2)–(4): class (with subsidiaries) and PG equal the row's. The class
 * comparison is the resolver's (`class_mismatch`, which also honours the offeror's §173.150(f)
 * combustible election); the PG comparison is set membership against the row's own PG column.
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

/** paper_technical_name — §172.203(k): an entry the HMT marks "G" shows its technical name. */
export function paperTechnicalName(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_technical_name", ctx.index);
  const g = gated(ctx, r, ["technicalName", "psn"]);
  if (g) return g;
  const row = rowOf(ctx);
  const label = lineLabel(ctx);
  if (!row) return r("cannot_tell", "line_unresolved", { lineLabel: label });
  if (!Array.isArray(row.entry.symbols)) return r("cannot_tell", "requirement_not_in_dataset", { lineLabel: label, needs: "HMT column 1 symbols" });
  if (!row.entry.symbols.includes("G")) return r("pass", "not_required", { lineLabel: label });
  const tech = technicalNameText(ctx.printed);
  if (tech) return r("pass", "printed", { lineLabel: label, technicalName: tech });
  return r("fail", "missing", { lineLabel: label, requiredPsn: row.entry.psnPrinted });
}

/**
 * paper_quantity_present — §172.202(a)(5): a total quantity with its unit. docs/17 A.2: bulk may show
 * "1 cargo tank" instead (§172.202(a)(5)(i)), and a residue line needs none. Needs no row.
 */
export function paperQuantityPresent(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_quantity_present", ctx.index);
  const g = gated(ctx, r, ["quantity", "packaging", "packageCount", "marks"]);
  if (g) return g;
  const p = ctx.printed;
  const label = lineLabel(ctx);
  const { value, unit } = p.quantity;
  if (value != null && value > 0 && !blank(unit)) return r("pass", "printed", { lineLabel: label, value, unit: unit!.trim() });
  if ((p.packageCount ?? 0) >= 1 && /\bcargo\s+tanks?\b/i.test(p.packaging ?? "")) {
    return r("pass", "bulk_cargo_tank", { lineLabel: label, packaging: p.packaging!.trim() });
  }
  if ([...p.marks, p.psn ?? ""].some((s) => /\bresidue\b/i.test(s))) return r("pass", "residue", { lineLabel: label });
  if (value != null && blank(unit)) return r("fail", "unit_missing", { lineLabel: label, value });
  return r("fail", "missing", { lineLabel: label });
}

/**
 * paper_hm_column — §172.201(a)(1): on a paper that also lists non-hazardous items, hazmat entries are
 * listed first, OR in a contrasting colour, OR marked "X" (or "RQ") in an HM column — docs/17 A.1: on
 * mixed papers only. The reader sees the mark but not order or colour, so an unmarked line on a mixed
 * (or possibly mixed) paper is `cannot_tell`, never `fail`.
 */
export function paperHmColumn(ctx: LineCtx): PaperRuleResult {
  const r = make("paper_hm_column", ctx.index);
  const g = gated(ctx, r, ["hmColumnMark"]);
  if (g) return g;
  const label = lineLabel(ctx);
  if (ctx.printed.hmColumnMark) return r("pass", "marked", { lineLabel: label, mark: ctx.printed.hmColumnMark });
  if (ctx.paper.mixedPaper === false) return r("pass", "not_mixed", { lineLabel: label });
  return r("cannot_tell", "identification_method_not_read", { lineLabel: label, mixedPaper: ctx.paper.mixedPaper ?? null });
}

