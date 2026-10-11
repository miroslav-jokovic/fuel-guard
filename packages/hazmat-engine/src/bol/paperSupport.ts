/**
 * What every printed-paper rule shares: the dataset view, the field-state gate, the row a line resolved
 * to, and the marks a shipper prints in free text (LQ, RQ, Marine Pollutant).
 */
import type {
  PaperDsEntry,
  PaperDsView,
  PaperFacts,
  PaperFieldStates,
  PaperRuleId,
  PaperRuleResult,
  PrintedPaperLine,
  ResolvedPaper,
  ResolvedPaperLine,
} from "./paperTypes.js";

export function readPaperDataset(dataset: unknown): PaperDsView {
  const d = (dataset ?? {}) as Partial<PaperDsView>;
  return {
    entries: Array.isArray(d.entries) ? d.entries : [],
    hazSubstances: Array.isArray(d.hazSubstances) ? d.hazSubstances : [],
    marinePollutants: Array.isArray(d.marinePollutants) ? d.marinePollutants : [],
  };
}

/** Everything a per-line rule reads. `path(key)` is the shared field-path of this line's `key`. */
export interface LineCtx {
  index: number;
  printed: PrintedPaperLine;
  resolved: ResolvedPaperLine;
  paper: ResolvedPaper;
  ds: PaperDsView;
  states: PaperFieldStates;
  path: (key: keyof PrintedPaperLine) => string;
}

export const blank = (s: string | null | undefined): boolean => s == null || s.trim() === "";
export const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
/** Every free-text place a shipper prints a word on the line: marks, name, technical name, description. */
export const lineTexts = (line: PrintedPaperLine): string[] =>
  [...line.marks, line.psn ?? "", line.technicalName ?? "", line.descriptionText ?? ""].filter((t) => t.trim() !== "");

export function make(ruleId: PaperRuleId, lineIndex: number | null) {
  return (outcome: PaperRuleResult["outcome"], reason: string, facts: PaperFacts = {}): PaperRuleResult => ({
    ruleId,
    outcome,
    lineIndex,
    reason,
    facts,
  });
}

/**
 * The field-state gate. A rule that needs a field the reader marked Check or Not read answers
 * `cannot_tell`, never `pass` — and never `fail` either, because a Not-read null is "unknown", not
 * "absent". A state on a descendant counts (`hazmat.lines[0].quantity.value` gates `…quantity`).
 */
export function unconfirmed(states: PaperFieldStates, paths: readonly string[]): string[] {
  const hits = Object.keys(states).filter(
    (key) =>
      states[key] !== "read" &&
      paths.some((p) => key === p || key.startsWith(`${p}.`) || key.startsWith(`${p}[`)),
  );
  return hits.sort();
}

/** Gate first: a Check or Not-read field the rule needs makes the answer `cannot_tell`. */
export function gated(ctx: LineCtx, r: ReturnType<typeof make>, keys: Array<keyof PrintedPaperLine>): PaperRuleResult | null {
  const open = unconfirmed(ctx.states, keys.map(ctx.path));
  return open.length ? r("cannot_tell", "field_unconfirmed", { lineLabel: lineLabel(ctx), unconfirmed: open }) : null;
}

/** The printed handle a sentence names a line by: its id, else its name, else its position. */
export function lineLabel(ctx: LineCtx): string {
  if (!blank(ctx.printed.idText)) return ctx.printed.idText!.trim();
  if (!blank(ctx.printed.psn)) return ctx.printed.psn!.trim();
  return `Line ${ctx.index + 1}`;
}

/**
 * The HMT row this line is about. A resolved line names it; two resolver FAILURES also pin a single
 * entry — `class_mismatch` and `pg_required_ambiguous` run after the id and the name already matched,
 * and hand back that one entry as their only candidate. `pg` is the row's PG when one row was selected,
 * `undefined` when only the entry is known.
 */
export interface Row {
  entry: PaperDsEntry;
  pg: "I" | "II" | "III" | null | undefined;
}
const ENTRY_PINNING_FAILURES = new Set(["class_mismatch", "pg_required_ambiguous"]);
export function rowOf(ctx: LineCtx): Row | null {
  const res = ctx.resolved.resolution;
  if (!res) return null;
  const find = (entryId: string) => ctx.ds.entries.find((e) => e.entryId === entryId) ?? null;
  if (res.ok) {
    const entry = find(res.entryId);
    return entry ? { entry, pg: res.pg } : null;
  }
  if (ENTRY_PINNING_FAILURES.has(res.reason) && res.candidates?.length === 1) {
    const entry = find(res.candidates[0]!.entryId);
    return entry ? { entry, pg: undefined } : null;
  }
  return null;
}

/** The PGs the row allows: the selected one, or every PG row of the entry when none was selected. */
export function requiredPgs(row: Row): Array<"I" | "II" | "III" | null> {
  return row.pg !== undefined ? [row.pg] : row.entry.pgRows.map((r) => r.pg);
}

/**
 * "3", or "3 (6.1)" with subsidiaries — §172.202(a)(3)'s form ("the subsidiary hazard class(es) … must be
 * entered in parentheses immediately following the primary hazard class"), from the row.
 */
export function formatClass(entry: PaperDsEntry): string {
  const subs = entry.subsidiaryClasses ?? [];
  return `${entry.hazardClass ?? ""}${subs.length ? ` (${subs.join(", ")})` : ""}`.trim();
}

/**
 * §172.202(a)(3)(ii): "The hazard class need not be included for the entry "Combustible liquid, n.o.s."".
 * The regulation names the entry, so the test is on the row's printed PSN.
 */
export function classMayBeOmitted(entry: PaperDsEntry): boolean {
  return norm(entry.psnPrinted) === "combustible liquid, n.o.s.";
}

/** Every name the paper gives the material's technical name: the field, or a trailing parenthetical. */
export function technicalNameText(line: PrintedPaperLine): string | null {
  if (!blank(line.technicalName)) return line.technicalName!.trim();
  const m = /\(([^)]+)\)\s*$/.exec(line.psn ?? "");
  return m ? m[1]!.trim() : null;
}

/**
 * How many components the printed technical name names — §172.203(k)(1)'s "at least two components".
 * "contains Toluene and Xylene" is two; a leading "contains"/"containing" is §172.203(k)'s permitted
 * modifier, not a name.
 */
export function namedComponentCount(line: PrintedPaperLine): number {
  const text = technicalNameText(line);
  if (!text) return 0;
  const parts = text.replace(/^\s*(contains|containing)\b/i, "").split(/,|\band\b/i).map(norm).filter(Boolean);
  return new Set(parts).size;
}

/** The technical name split into the components a lookup table could list ("toluene, xylene"). */
export function technicalComponents(line: PrintedPaperLine): string[] {
  const text = technicalNameText(line);
  if (!text) return [];
  const parts = text.split(/,|\band\b/i).map(norm).filter(Boolean);
  return [...new Set([norm(text), ...parts])];
}

export function entryNames(entry: PaperDsEntry): string[] {
  return [entry.psnPrinted, ...(entry.psnAlternates ?? [])].filter((n): n is string => typeof n === "string").map(norm);
}

// ── marks printed as free text ────────────────────────────────────────────────────────────────────
/**
 * §172.203(b)'s notation. ONE definition: the hazmat extractor's `lineDeclaresLq` (apps/api bolFields.ts)
 * calls this, so the paper audit and the placard path can never disagree on whether a line says LQ.
 */
export const LQ_RX = /\b(limited\s+quantity|ltd\.?\s*qty\.?)\b/i;
export function declaresLimitedQuantity(line: {
  readonly marks?: readonly string[] | null;
  readonly psn: string | null;
  readonly packaging: string | null;
}): boolean {
  if ((line.marks ?? []).some((m) => LQ_RX.test(m))) return true;
  return LQ_RX.test(line.psn ?? "") || LQ_RX.test(line.packaging ?? "");
}

const MP_RX = /\bmarine\s+pollutant\b/i;
export function printsMarinePollutant(line: PrintedPaperLine): boolean {
  return [...line.marks, line.psn ?? "", line.technicalName ?? ""].some((s) => MP_RX.test(s));
}

/** §172.203(c): "RQ" before or after the description, or (§172.201(a)(1)) in the HM column. */
const RQ_RX = /(?:^|[\s,;(])RQ(?=$|[\s,;)])/i;
export function printsRq(line: PrintedPaperLine): boolean {
  if (line.hmColumnMark === "RQ") return true;
  return [...line.marks, line.psn ?? ""].some((s) => RQ_RX.test(s));
}
