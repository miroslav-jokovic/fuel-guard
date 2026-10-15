import { leafFieldPaths, valueAtPath, type FieldEvidence, type RoadsideInspectionReport } from "@silvicom/shared";
import type { OcrPage } from "./rowWitness.js";

/**
 * An officer's report's evidence (INSPECTION-CHALLENGE-PLAN D-IC13; DOCUMENT-READER-PLAN §7B, D-DR19):
 * for every field, what each witness said.
 *
 *   passA      the locked reader — the document the read returns.
 *   passB      the second reader, list entries paired by POSITION (a report prints its units and violations
 *              in numbered rows, so the nth row is the nth row; nothing like a BOL's re-ordered lines).
 *              Absent when pass B produced no document; a row only pass B saw is emitted after A's.
 *   ocr        on the fields the inspection module DECIDES on — report number, licence number, VIN — which
 *   textLayer  readers' values are printed anywhere on the read pages, compared as letters and digits only
 *              (a licence printed "D123-4567-8901" is the value "D12345678901"). The value is the list of
 *              readers backed, `["passA", "passB"]`, `["passB"]` or `[]`. Absent when there was no OCR.
 *
 * Why only those three: they are what confirms a driver (Q-IC11 (a), owner 2026-10-15). A licence two
 * readers agree on AND the page's own characters print is the strongest reading this pipeline can make; a
 * name is compared but never confirms, so it does not need the witness.
 *
 * Status as the shipping document's (rule 2): `not_read` when both readers read nothing there, otherwise
 * `check`. Agreement is recorded, not acted on here — the consumer decides what agreement is worth.
 */

const DECIDING = [/^reportNumber$/, /^driver\.licenseNumber$/, /^units\[\d+\]\.vin$/];
/** Shorter than this, a value could be found inside any run of characters, so it proves nothing printed. */
const MIN_WITNESSED_LENGTH = 5;

const compact = (v: unknown): string => (typeof v === "string" ? v.toUpperCase().replace(/[^A-Z0-9]/g, "") : "");

/** Each page's characters as one run, letters and digits only — the haystack a value is looked for in. */
const pageRuns = (pages: readonly OcrPage[]): string[] => pages.map((p) => p.items.map((i) => compact(i.text)).join(""));

function printedBy(runs: readonly string[], values: ReadonlyArray<readonly ["passA" | "passB", unknown]>): string[] {
  return values
    .filter(([, v]) => {
      const c = compact(v);
      return c.length >= MIN_WITNESSED_LENGTH && runs.some((run) => run.includes(c));
    })
    .map(([reader]) => reader);
}

type Doc = Partial<RoadsideInspectionReport>;

export function roadsideReportEvidence(
  a: Doc,
  b: Doc | null,
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
    if (DECIDING.some((rx) => rx.test(path)) && (av != null || bv != null)) {
      const readers: Array<readonly ["passA" | "passB", unknown]> = [];
      if (av !== undefined) readers.push(["passA", av]);
      if (bv !== undefined) readers.push(["passB", bv]);
      for (const [reader, runs] of witnesses) {
        if (runs) sources.push({ reader, page: null, bbox: null, value: printedBy(runs, readers) });
      }
    }
    const nothing = av == null && bv == null && av !== undefined && bv !== undefined;
    out.push({ path, value: (av ?? bv ?? null) as never, status: nothing ? "not_read" : "check", sources, ruleVersion });
  };

  const aPaths = leafFieldPaths(a);
  for (const path of aPaths) emit(path, true);
  // Rows only pass B saw: a row pass A missed is a disagreement, shown, never dropped.
  if (b) {
    const seen = new Set(aPaths);
    for (const path of leafFieldPaths(b)) if (!seen.has(path) && /\[\d+\]/.test(path)) emit(path, false);
  }
  return out;
}
