import { z } from "zod";
import { extentAgrees, isExtentPath } from "./readingExtent.js";

/**
 * FieldEvidence — what the document reader knows about ONE field (DOCUMENT-READER-PLAN.md §2, D-EXR1).
 *
 * The reader's output is a profile document (e.g. `ShippingDocument`) plus one of these per field it has
 * an opinion on. The document says what the value is; the evidence says why anyone should believe it:
 * which readers saw it, on which page, where, and what each of them read. A consumer's adapter
 * (`features/hazmat/bolPrefill.ts`) turns `status` into the field state the dispatcher sees (D-DR4) —
 * the module itself never decides how a form looks (D-DR2).
 *
 * `status` is the acceptance rule's verdict under `ruleVersion`, never a model's self-report:
 *   - `read`     independent evidence agrees (§4: two passes, or a pass and the text layer, or arithmetic);
 *   - `check`    readers disagree, or only one source saw it;
 *   - `not_read` nothing legible — `sources` still names where the reader looked, so the UI can show the crop.
 */

export const FIELD_STATUSES = ["read", "check", "not_read"] as const;
export type FieldStatus = (typeof FIELD_STATUSES)[number];

/**
 * Every kind of reader that can vote on a value. `textLayer` is a born-digital PDF's own characters
 * (D-DR3), `deviceOcr` the driver scanner's word boxes (Phase 6.3), `region` a re-read of a crop (Phase 5),
 * `arithmetic` a sum or product that reproduces the value (§4.4) — since Q-DR26 L3 the paper's own totals over
 * every row's count and weight (arithmeticWitness.ts): the reading they back, or null where none fits them —
 * `order` the McLeod order (§4.5),
 * `declaration` something the sender stated, `reviewer` a person's confirmation or correction.
 * `table` is a regulatory table the value must be consistent with — the Hazardous Materials Table for a
 * hazmat line (DOCUMENT-READER-PLAN §7B, D-DR19). It reads no page: its `value` is its verdict on the
 * line, and it can only ever stop a value, never be the second witness that makes one *Read* — a model can
 * invent a line the table finds perfectly consistent.
 * `ocr` is the open-source OCR engine run in the worker over the upright page (§7B A5, Q-DR22) — not
 * `deviceOcr`, which is the driver's phone. It is ROW-BOUND: its `value` is the one reader's value printed
 * on the row of the line's own UN id, or null when the row shows none of them (or more than one); its
 * `bbox` is that row. Like `table` it judges what the models read and reads nothing of its own (D-DR21).
 * Since §7B A4 `textLayer` is row-bound the same way, over a born-digital page's own characters.
 */
export const EVIDENCE_READERS = [
  "passA", "passB", "textLayer", "deviceOcr", "region", "arithmetic", "order", "declaration", "reviewer", "table", "ocr",
] as const;
export type EvidenceReader = (typeof EVIDENCE_READERS)[number];

/**
 * The readers that judge a value by the printed ROW of its line (rowWitness.ts): the OCR engine (A5) and a
 * born-digital page's text layer (A4). Each records the one reader's value the row shows, or null when it
 * shows none (or more than one). The paper audit and the calculator's field note read this list, so a third
 * row witness is counted by both the day it is added here.
 */
export const ROW_WITNESS_READERS = ["ocr", "textLayer"] as const satisfies readonly EvidenceReader[];


/** A box on the page's WORKING copy, as fractions 0..1 of its width and height, so it survives a resize. */
export const bboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});
export type Bbox = z.infer<typeof bboxSchema>;

/**
 * A field path into a profile document: dotted keys and `[n]` indexes, e.g. `identity.bolNumber`,
 * `hazmat.lines[2].quantity.value`. One grammar for evidence, reviews, labels and graduation counters,
 * so a review row and the evidence it confirms can be joined on the string.
 */
export const FIELD_PATH_RX = /^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*|\[\d+\])*$/;
export const fieldPathSchema = z.string().regex(FIELD_PATH_RX, "not a field path");

export const evidenceSourceSchema = z.object({
  reader: z.enum(EVIDENCE_READERS),
  /** 1-based page number within the source; null for readers with no page (order, declaration). */
  page: z.number().int().min(1).nullable(),
  bbox: bboxSchema.nullable().default(null),
  value: z.json(),
});
export type EvidenceSource = z.infer<typeof evidenceSourceSchema>;

export const fieldEvidenceSchema = z.object({
  path: fieldPathSchema,
  value: z.json(),
  status: z.enum(FIELD_STATUSES),
  sources: z.array(evidenceSourceSchema),
  /** The acceptance rule that produced `status`. A graduation count belongs to one rule version (D-DR5). */
  ruleVersion: z.string().min(1),
});
export type FieldEvidence = z.infer<typeof fieldEvidenceSchema>;

type Segment = string | number;

/** `hazmat.lines[2].psn` → `["hazmat", "lines", 2, "psn"]`. Throws on a malformed path. */
export function parseFieldPath(path: string): Segment[] {
  if (!FIELD_PATH_RX.test(path)) throw new Error(`not a field path: ${path}`);
  const out: Segment[] = [];
  for (const m of path.matchAll(/([A-Za-z]+)|\[(\d+)\]/g)) out.push(m[1] ?? Number(m[2]));
  return out;
}

/** The inverse of `parseFieldPath`. */
export function formatFieldPath(segments: readonly Segment[]): string {
  return segments.map((s, i) => (typeof s === "number" ? `[${s}]` : i === 0 ? s : `.${s}`)).join("");
}

/**
 * The value at `path` in `doc`, or `undefined` when the path does not exist there (an index past the end
 * of `lines`). `undefined` and `null` differ on purpose: null is "the paper has no value", undefined is
 * "this document has no such field" — `doc:score` counts the two differently.
 */
export function valueAtPath(doc: unknown, path: string): unknown {
  let cur: unknown = doc;
  for (const seg of parseFieldPath(path)) {
    if (cur == null || typeof cur !== "object") return undefined;
    if (typeof seg === "number" ? !Array.isArray(cur) : Array.isArray(cur)) return undefined;
    cur = (cur as Record<string | number, unknown>)[seg];
  }
  return cur;
}

/**
 * Every LEAF path in `doc` — scalars, nulls, and arrays of scalars (a `marks` list is one field: it is
 * read, compared and confirmed as a whole). Objects and arrays of objects are walked. This is the set an
 * acceptance rule must give evidence for and `doc:score` must score; deriving it from the document means
 * a field added to a profile is scored the day it is added, not the day somebody remembers.
 */
export function leafFieldPaths(doc: unknown, prefix: Segment[] = []): string[] {
  const isLeafArray = (a: unknown[]) => a.every((v) => v == null || typeof v !== "object");
  if (doc != null && typeof doc === "object" && !(Array.isArray(doc) && isLeafArray(doc))) {
    const entries: [Segment, unknown][] = Array.isArray(doc) ? doc.map((v, i) => [i, v]) : Object.entries(doc);
    return entries.flatMap(([k, v]) => leafFieldPaths(v, [...prefix, k]));
  }
  return prefix.length ? [formatFieldPath(prefix)] : [];
}

/**
 * The one comparison two readers' values are judged by (DOCUMENT-READER-PLAN §7B A3, D-DR19), shared so
 * the API that records agreement and the screen that shows it cannot disagree about it. Deliberately
 * narrow: case, surrounding space and runs of space are not differences (one model writes "DRUMS", another
 * "Drums"); a thousands comma in a number written as text is not; trailing zeros after a decimal point are
 * not; ANY other difference is — a digit, a letter, a significant decimal place, null against a value.
 * Never fuzzy: a near-miss is a disagreement for a person.
 *
 * WHY TRAILING ZEROS. Production read d0f2831a (2026-10-15, four hazmat lines) had both readers agree on
 * every count and weight, yet all four package fields were disputed: one reader copied the shipper's
 * system-printed "48.0000 Non-Removable Head Plastic Jerrican", the other wrote "48 …". The same number
 * twice stopped Calculate four times. A decimal token is rewritten without its trailing zeros ("48.0000" →
 * "48", "5.50" → "5.5"); its integer part is never touched, and a token inside a dotted run ("10.10.2026",
 * "1.2.0") is left whole, so a date or a version that differs in one zero still disagrees.
 */
export function normalisedForAgreement(v: unknown): unknown {
  if (typeof v === "string") {
    // Spacing around punctuation and line breaks (production read 76979453, 2026-10-19): both readers read
    // every character of three hazmat descriptions alike, but one wrote "CORROSIVE LIQUID , N.O.S." with a
    // space before the comma, and the audit could check none of the three lines; three addresses were broken
    // across lines by one reader where the other wrote ", ". So a space before , . ; : ) or after ( is not a
    // difference, and a line break (with or without a comma before it) reads as ", ". Every letter, digit and
    // punctuation mark still counts (`agreement.property.test.ts`, over every table name).
    return v.trim().replace(/[ \t]*,?[ \t]*(?:\r?\n[ \t]*)+/g, ", ").replace(/\s+/g, " ").replace(/ (?=[,.;:)])|(?<=\() /g, "").toUpperCase().replace(/(\d),(\d{3})(?!\d)/g, "$1$2")
      .replace(/(?<![\d.])(\d+)\.(\d+)(?![\d]|\.\d)/g, (_, int: string, frac: string) => {
        const f = frac.replace(/0+$/, "");
        return f ? `${int}.${f}` : int;
      });
  }
  if (Array.isArray(v)) return v.map(normalisedForAgreement);
  return v ?? null;
}

export function valuesAgree(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalisedForAgreement(a)) === JSON.stringify(normalisedForAgreement(b));
}

/**
 * Whether two readers' values of the field at `path` agree: `valuesAgree`, and — for a free-text cell one
 * reader may transcribe further than the other (a description's commercial tail, a packaging cell's
 * item-code line) — the same facts with a tail that carries none (`extentAgrees`, readingExtent.ts, R-M2).
 */
export function readingsAgree(path: string | undefined, a: unknown, b: unknown): boolean {
  return valuesAgree(a, b) || (isExtentPath(path) && extentAgrees(path!, a, b, normalisedForAgreement));
}

/**
 * Whether a field's two model readers agree: true / false when both pass A and pass B recorded a value, null
 * when either is absent (one reader only — never agreement). Given the field's `path`, an extent cell is
 * judged by its facts (`readingsAgree`); without one, by `valuesAgree` alone.
 */
export function readersAgree(e: Pick<FieldEvidence, "sources"> & { path?: string }): boolean | null {
  const a = e.sources.find((s) => s.reader === "passA");
  const b = e.sources.find((s) => s.reader === "passB");
  return a && b ? readingsAgree(e.path, a.value, b.value) : null;
}

/**
 * Whether the paper's totals back a field's value (the `arithmetic` reader, Q-DR26 L3): true when they show
 * that value, false when they show another reading or none fits, null when they did not judge it.
 */
export function arithmeticBacks(e: Pick<FieldEvidence, "value" | "sources">): boolean | null {
  const s = e.sources.find((x) => x.reader === "arithmetic");
  return s === undefined ? null : s.value !== null && valuesAgree(s.value, e.value);
}

/**
 * The one reading every printed witness that judged a field shows — the row witnesses and the paper's
 * totals — when there is exactly one and a model reader read it; null otherwise. This is what a screen
 * may put first for a person to confirm (the owner, 2026-10-15: "keep the click"): never a value no reader
 * read, and never one the witnesses split on.
 */
export function witnessedReading(e: Pick<FieldEvidence, "sources">): unknown {
  const shown = e.sources.filter((s) => s.reader === "arithmetic" || (ROW_WITNESS_READERS as readonly string[]).includes(s.reader));
  if (shown.length === 0 || shown.some((s) => s.value === null || !valuesAgree(s.value, shown[0]!.value))) return null;
  const read = e.sources.some((s) => (s.reader === "passA" || s.reader === "passB") && valuesAgree(s.value, shown[0]!.value));
  return read ? shown[0]!.value : null;
}

/**
 * Whether the row witnesses back a field's value: true when every one that judged it shows that value, false
 * when one shows another value or none, null when none judged it.
 */
export function rowWitnessesBack(e: Pick<FieldEvidence, "value" | "sources">): boolean | null {
  const judged = e.sources.filter((s) => (ROW_WITNESS_READERS as readonly string[]).includes(s.reader));
  return judged.length === 0 ? null : judged.every((s) => s.value !== null && valuesAgree(s.value, e.value));
}
