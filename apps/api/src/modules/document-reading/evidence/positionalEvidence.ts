import { leafFieldPaths, valueAtPath, type FieldEvidence } from "@silvicom/shared";
import type { OcrPage } from "./rowWitness.js";

/**
 * Evidence for a profile whose lists are PRINTED IN ORDER — an officer's report's numbered rows, a stack
 * of papers in page order — so the nth entry of one reader is the nth entry of the other. Lifted out of
 * `roadsideReportEvidence.ts` on 2026-10-21 for the second such profile (`compliance_paper`, UNIT-FILES-PLAN
 * UF7b2) rather than copied: one rule for "what each witness said", two lists of the fields that decide.
 *
 *   passA      the document the read returns.
 *   passB      the second reader, list entries paired by position; absent when there was none. A row only
 *              pass B saw is emitted after A's — a row pass A missed is a disagreement, shown, never dropped.
 *   ocr        on the `deciding` paths only: which readers' values are printed anywhere on the read pages,
 *   textLayer  compared as letters and digits only ("D123-4567-8901" is "D12345678901"). The value is the
 *              list of readers backed — `["passA", "passB"]`, `["passA"]` or `[]`. Absent with no OCR.
 *
 * Status: `not_read` when every reader the profile ASKED read nothing there, otherwise `check`. A
 * two-reader profile whose pass B failed asked two and heard one, so a null from A alone stays `check`
 * (the roadside rule since IC10); a one-reader profile asked one, so its null is `not_read`.
 * Agreement is recorded, not acted on here — the consumer decides what agreement is worth.
 */
export interface PositionalEvidenceRule {
  /** The paths whose values a consumer decides on — the only ones the OCR witness is asked about. */
  deciding: readonly RegExp[];
  /** How many readers the profile reads with (`DocumentProfile.readers`). */
  readers: 1 | 2;
}

/** Shorter than this, a value could be found inside any run of characters, so it proves nothing printed. */
const MIN_WITNESSED_LENGTH = 5;

const compact = (v: unknown): string => (typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

/** Each page's characters as one run, letters and digits only — the haystack a value is looked for in. */
const pageRuns = (pages: readonly OcrPage[]): string[] => pages.map((p) => p.items.map((i) => compact(i.text)).join(""));

const printed = (runs: readonly string[], v: unknown): boolean => {
  const c = compact(v);
  return c.length >= MIN_WITNESSED_LENGTH && runs.some((run) => run.includes(c));
};

/**
 * The readers whose value the page prints. A list of strings is ONE field (`leafFieldPaths` stops at a list
 * of scalars — a paper's `vins`), and it is backed only when EVERY entry is printed: a reader that added one
 * VIN the page does not show has not been confirmed by the page.
 */
function printedBy(runs: readonly string[], values: ReadonlyArray<readonly ["passA" | "passB", unknown]>): string[] {
  return values
    .filter(([, v]) => (Array.isArray(v) ? v.length > 0 && v.every((x) => printed(runs, x)) : printed(runs, v)))
    .map(([reader]) => reader);
}

export function positionalEvidence(
  rule: PositionalEvidenceRule,
  a: object,
  b: object | null,
  ruleVersion: string,
  ocr: readonly OcrPage[] | null = null,
  textLayer: readonly OcrPage[] | null = null,
): FieldEvidence[] {
  const witnesses = [["ocr", ocr ? pageRuns(ocr) : null], ["textLayer", textLayer ? pageRuns(textLayer) : null]] as const;
  const out: FieldEvidence[] = [];
  const emit = (path: string, aHas: boolean) => {
    const av = aHas ? valueAtPath(a, path) ?? null : undefined;
    const bv = b ? valueAtPath(b, path) ?? null : undefined;
    const sources: FieldEvidence["sources"] = [];
    if (av !== undefined) sources.push({ reader: "passA", page: null, bbox: null, value: av as never });
    if (bv !== undefined) sources.push({ reader: "passB", page: null, bbox: null, value: bv as never });
    if (rule.deciding.some((rx) => rx.test(path)) && (av != null || bv != null)) {
      const readers: Array<readonly ["passA" | "passB", unknown]> = [];
      if (av !== undefined) readers.push(["passA", av]);
      if (bv !== undefined) readers.push(["passB", bv]);
      for (const [reader, runs] of witnesses) {
        if (runs) sources.push({ reader, page: null, bbox: null, value: printedBy(runs, readers) });
      }
    }
    const empty = (v: unknown) => v == null || (Array.isArray(v) && v.length === 0);
    const nothing = rule.readers === 1
      ? empty(av) && av !== undefined
      : av == null && bv == null && av !== undefined && bv !== undefined;
    out.push({ path, value: (av ?? bv ?? null) as never, status: nothing ? "not_read" : "check", sources, ruleVersion });
  };

  const aPaths = leafFieldPaths(a);
  for (const path of aPaths) emit(path, true);
  if (b) {
    const seen = new Set(aPaths);
    for (const path of leafFieldPaths(b)) if (!seen.has(path) && /\[\d+\]/.test(path)) emit(path, false);
  }
  return out;
}
