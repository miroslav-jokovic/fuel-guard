import { z } from "zod";

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
 * `arithmetic` a sum or product that reproduces the value (§4.4), `order` the McLeod order (§4.5),
 * `declaration` something the sender stated, `reviewer` a person's confirmation or correction.
 */
export const EVIDENCE_READERS = [
  "passA", "passB", "textLayer", "deviceOcr", "region", "arithmetic", "order", "declaration", "reviewer",
] as const;
export type EvidenceReader = (typeof EVIDENCE_READERS)[number];

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
