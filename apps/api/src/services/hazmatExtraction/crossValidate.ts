import { normalizePsn } from "@hazmat/data";
import { pageComplete, type BolFields, type BolLineFields } from "./bolFields.js";

/**
 * Deterministic cross-validation (plan H6 step 4) — the checks that make a wrong read impossible to pass
 * silently (D2). NONE of this is AI: two independent vision passes are compared field-by-field, printed
 * arithmetic is recomputed, and the extracted lines are reconciled against what the dispatcher declared.
 * Every function is pure and returns named flags; any non-empty result routes the load to `needs_review`.
 */
const digitsOf = (s: string | null): string => (s ?? "").replace(/[^0-9]/g, "");
const normName = (s: string | null): string => (s == null ? "" : normalizePsn(s));

/** Fields whose disagreement between passes is safety-critical (the rest — shipper spelling — may diverge). */
function lineDisagreements(a: BolLineFields, b: BolLineFields, i: number): string[] {
  const out: string[] = [];
  const at = (field: string) => `pass_disagreement:${field}:line${i + 1}`;
  if (digitsOf(a.idText) !== digitsOf(b.idText)) out.push(at("idNumber"));
  if (normName(a.psn) !== normName(b.psn)) out.push(at("psn"));
  if ((a.hazardClass ?? "").trim().toLowerCase() !== (b.hazardClass ?? "").trim().toLowerCase()) out.push(at("class"));
  if (a.pg !== b.pg) out.push(at("pg"));
  if (a.quantity.value !== b.quantity.value) out.push(at("quantityValue"));
  if (normName(a.quantity.unit) !== normName(b.quantity.unit)) out.push(at("quantityUnit"));
  if (a.packageCount !== b.packageCount) out.push(at("packageCount"));
  if (a.hmColumnMark !== b.hmColumnMark) out.push(at("hmColumnMark"));
  return out;
}

/**
 * Dual-pass agreement (step 4b): passes A and B must agree EXACTLY on the safety-critical fields. A
 * differing line count is itself a disagreement (one pass saw a line the other missed).
 */
export function checkAgreement(a: BolFields, b: BolFields): string[] {
  const flags: string[] = [];
  if (a.lines.length !== b.lines.length) flags.push("pass_disagreement:line_count");
  const n = Math.min(a.lines.length, b.lines.length);
  for (let i = 0; i < n; i++) flags.push(...lineDisagreements(a.lines[i]!, b.lines[i]!, i));
  if (digitsOf(a.emergencyPhone) !== digitsOf(b.emergencyPhone)) flags.push("pass_disagreement:emergencyPhone");
  if (a.shipperCertification !== b.shipperCertification) flags.push("pass_disagreement:certification");
  return flags;
}

const TOL = 0.02; // 2% arithmetic tolerance (plan step 4c/4d)
const offBy = (actual: number, expected: number): boolean =>
  Math.abs(actual - expected) / Math.max(Math.abs(expected), 1) > TOL;

/**
 * Printed arithmetic (step 4c): count × per-package weight must equal the extended line weight; the sum of
 * line weights must equal the printed total; and every page of a multi-page set must be present.
 */
export function checkArithmetic(bol: BolFields): string[] {
  const flags: string[] = [];
  bol.lines.forEach((l, i) => {
    if (l.packageCount != null && l.perPackageWeightLb != null && l.grossWeightLb != null) {
      if (offBy(l.grossWeightLb, l.packageCount * l.perPackageWeightLb)) flags.push(`extended_weight_mismatch:line${i + 1}`);
    }
  });
  if (bol.totalGrossWeightLb != null) {
    const lineWeights = bol.lines.map((l) => l.grossWeightLb).filter((w): w is number => w != null);
    if (lineWeights.length > 0) {
      const sum = lineWeights.reduce((a, b) => a + b, 0);
      if (offBy(sum, bol.totalGrossWeightLb)) flags.push("total_weight_mismatch");
    }
  }
  if (!pageComplete(bol)) flags.push("page_incomplete");
  return flags;
}

export interface DeclaredForReconcile {
  hmtRef: string;
  quantityValue?: number | null;
}
export interface ExtractedForReconcile {
  hmtRef: string;
  quantityValue: number | null;
}

/**
 * Declared-vs-extracted reconciliation (step 4d): every extracted line must match a declared line (by
 * canonical `hmtRef`) and their quantities agree within 2%; an unmatched line in EITHER direction flags.
 * When there are no declared lines (driver self-created), the caller skips this and the load never
 * auto-clears — a human confirms the lines instead (`lines_unconfirmed`, owned by the outcome table).
 */
export function reconcileDeclaredVsExtracted(
  declared: DeclaredForReconcile[],
  extracted: ExtractedForReconcile[],
): string[] {
  const flags: string[] = [];
  const declByRef = new Map(declared.map((d) => [d.hmtRef, d]));
  const extRefs = new Set(extracted.map((e) => e.hmtRef));

  for (const e of extracted) {
    const d = declByRef.get(e.hmtRef);
    if (!d) {
      flags.push(`extracted_line_not_declared:${e.hmtRef}`);
      continue;
    }
    if (d.quantityValue != null && e.quantityValue != null && offBy(e.quantityValue, d.quantityValue)) {
      flags.push(`quantity_mismatch:${e.hmtRef}`);
    }
  }
  for (const d of declared) {
    if (!extRefs.has(d.hmtRef)) flags.push(`declared_line_not_extracted:${d.hmtRef}`);
  }
  return flags;
}
