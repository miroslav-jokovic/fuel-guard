import { z } from "zod";
import { declaresLimitedQuantity } from "@hazmat/engine";
import { printedHazmatLineSchema, type ShippingDocument } from "@silvicom/shared";

/**
 * BolFields (plan H6) — the STRUCTURED fields read from a bill of lading. This is the extraction contract:
 * the vision passes emit it (Zod-validated), the cross-validation battery checks it, and the mapper turns
 * it into an engine LoadInput. It is deliberately "data only" — no verdicts, no interpretation (D1: AI
 * reads, code decides). Everything here is text/numbers as PRINTED; resolveHmtLine + the engine decide
 * what it means. Server-only (extraction runs server-side, ANTHROPIC_API_KEY never leaves the API).
 */

/**
 * One printed hazmat line. The shape moved to `packages/shared/src/shippingDocumentContract.ts` (document
 * reader Step 1.1) so the reading module and this extractor validate the same line; the name stays here
 * because every hazmat-path test and the forced-tool schema below know it by this name.
 */
export const bolLineFieldsSchema = printedHazmatLineSchema;
export type BolLineFields = z.infer<typeof bolLineFieldsSchema>;

export const bolFieldsSchema = z.object({
  lines: z.array(bolLineFieldsSchema).default([]),
  /** §172.604 emergency-response phone, digits as printed. */
  emergencyPhone: z.string().nullable().default(null),
  /** §172.204 shipper's certification present on the paper. */
  shipperCertification: z.boolean().default(false),
  offerorName: z.string().nullable().default(null),
  /** "1 of N" page info; drives the page-completeness check. */
  pageInfo: z
    .object({ page: z.number().int().nullable().default(null), of: z.number().int().nullable().default(null) })
    .default({ page: null, of: null }),
  /** Printed load total, when present (for the qty-vs-total arithmetic check). */
  totalGrossWeightLb: z.number().nullable().default(null),
});
export type BolFields = z.infer<typeof bolFieldsSchema>;

/**
 * `BolFields` as a projection of the reader's `ShippingDocument` (DOCUMENT-READER-PLAN.md §2): the hazmat
 * section maps across key for key, the page marker and the load total come from `identity` and `freight`.
 * A total printed in kilograms becomes null rather than a converted number — the arithmetic check then
 * has nothing to compare, which is the honest outcome (plan §6: never converted silently). An unknown
 * certification (null) becomes false, this contract's "not seen on the paper".
 */
export function bolFieldsFromShippingDocument(doc: ShippingDocument): BolFields {
  return bolFieldsSchema.parse({
    lines: doc.hazmat.lines,
    emergencyPhone: doc.hazmat.emergencyPhone,
    shipperCertification: doc.hazmat.shipperCertification ?? false,
    offerorName: doc.hazmat.offeror,
    pageInfo: doc.identity.pageOf ?? { page: null, of: null },
    totalGrossWeightLb: doc.freight.weightUnit === "lb" ? doc.freight.weight : null,
  });
}

export function parseBolFields(raw: unknown): BolFields {
  return bolFieldsSchema.parse(raw);
}

// ── unit normalization (printed → the engine's closed set) ─────────────────────────────────────────
const UNIT_MAP: Record<string, "gal" | "lb" | "kg" | "L"> = {
  gal: "gal", gals: "gal", gallon: "gal", gallons: "gal",
  l: "L", liter: "L", liters: "L", litre: "L", litres: "L",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  kg: "kg", kgs: "kg", kilogram: "kg", kilograms: "kg",
};
/** Map a printed unit to the engine's closed set, or null if unrecognized (→ fail-closed at the mapper). */
export function normalizeUnit(printed: string | null): "gal" | "lb" | "kg" | "L" | null {
  if (printed == null) return null;
  return UNIT_MAP[printed.trim().toLowerCase().replace(/\.$/, "")] ?? null;
}

// ── pre-printed catalog lines (plan H6 step 4c2 — verified real-world pattern) ──────────────────────
export type LineLoadState = "loaded" | "preprinted_not_loaded" | "partial";
/**
 * Shipper templates pre-print every product they ever ship; only lines with handwritten counts/weights are
 * aboard. A line with NO quantity, NO count AND NO weight is a dormant template line (surfaced as a one-tap
 * "not loaded — correct?" confirmation, never a hard flag). A count without a weight (or vice versa) is a
 * `partial` — a normal flag, because a half-filled line is a real error until confirmed.
 */
export function classifyLineLoadState(line: BolLineFields): LineLoadState {
  const hasQty = line.quantity.value != null && line.quantity.value > 0;
  const hasCount = line.packageCount != null && line.packageCount > 0;
  const hasWeight = line.grossWeightLb != null && line.grossWeightLb > 0;
  if (!hasQty && !hasCount && !hasWeight) return "preprinted_not_loaded";
  if (hasQty || (hasCount && hasWeight)) return "loaded";
  return "partial";
}


// ── H-LQ: the §172.203(b)/§172.315 notation as printed ─────────────────────────────────────────────
/**
 * Does this printed line identify the material as a LIMITED QUANTITY? Checked across the marks array,
 * the shipping-name text and the packaging phrase — shippers print it in any of the three. This is the
 * paper-side half of §172.500(b)(2); the engine still independently verifies authorization (col 8A +
 * the 66-lb cap) and refuses fail-closed, so a false positive here can never strip a placard on its own
 * — and the pipeline additionally requires BOTH vision passes to agree before the flag is set at all.
 *
 * The notation itself is the engine's (`declaresLimitedQuantity`), since the printed-paper audit
 * (`auditPrintedPaper`, document reader D-DR6) asks the same question and the two must never disagree.
 */
export function lineDeclaresLq(line: BolLineFields): boolean {
  return declaresLimitedQuantity(line);
}

/** Page completeness from "page X of N": complete only when a single page or when page===of on the last one. */
export function pageComplete(bol: BolFields): boolean {
  const { page, of } = bol.pageInfo;
  if (of == null) return true; // no multi-page marker → treat as complete (nothing to reconcile)
  if (of <= 1) return true;
  return page != null && page === of; // a real multi-page set needs all pages; caller counts documents
}
