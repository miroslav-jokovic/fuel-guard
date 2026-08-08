import { z } from "zod";

/**
 * BolFields (plan H6) — the STRUCTURED fields read from a bill of lading. This is the extraction contract:
 * the vision passes emit it (Zod-validated), the cross-validation battery checks it, and the mapper turns
 * it into an engine LoadInput. It is deliberately "data only" — no verdicts, no interpretation (D1: AI
 * reads, code decides). Everything here is text/numbers as PRINTED; resolveHmtLine + the engine decide
 * what it means. Server-only (extraction runs server-side, ANTHROPIC_API_KEY never leaves the API).
 */

export const bolLineFieldsSchema = z.object({
  /** The id exactly as printed ("UN1203", "NA 1993", "1203"). */
  idText: z.string().nullable().default(null),
  psn: z.string().nullable().default(null),
  /** As printed: "3", "3 (6.1)", "Combustible liquid". */
  hazardClass: z.string().nullable().default(null),
  pg: z.enum(["I", "II", "III"]).nullable().default(null),
  /** The G-entry appended technical name (§172.203(k)), if printed separately. */
  technicalName: z.string().nullable().default(null),
  /** Quantity as printed, with its printed unit string (normalized later). */
  quantity: z
    .object({ value: z.number().nullable().default(null), unit: z.string().nullable().default(null) })
    .default({ value: null, unit: null }),
  grossWeightLb: z.number().nullable().default(null),
  packageCount: z.number().int().nullable().default(null),
  /** Per-package weight as printed (enables the count × per-package = extended-weight arithmetic check). */
  perPackageWeightLb: z.number().nullable().default(null),
  /** Packaging phrase as printed ("1 cargo tank", "10 drums", "cases"). */
  packaging: z.string().nullable().default(null),
  /** HM-column mark as printed: "X" (hazmat) or "RQ" (reportable quantity). §172.201(a)(1)(i). */
  hmColumnMark: z.enum(["X", "RQ"]).nullable().default(null),
  /** Marks printed on the line/package ("MARINE POLLUTANT", "LIMITED QUANTITY", "HOT"). */
  marks: z.array(z.string()).default([]),
});
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
const LQ_RX = /\b(limited\s+quantity|ltd\.?\s*qty\.?)\b/i;
/**
 * Does this printed line identify the material as a LIMITED QUANTITY? Checked across the marks array,
 * the shipping-name text and the packaging phrase — shippers print it in any of the three. This is the
 * paper-side half of §172.500(b)(2); the engine still independently verifies authorization (col 8A +
 * the 66-lb cap) and refuses fail-closed, so a false positive here can never strip a placard on its own
 * — and the pipeline additionally requires BOTH vision passes to agree before the flag is set at all.
 */
export function lineDeclaresLq(line: BolLineFields): boolean {
  if ((line.marks ?? []).some((m) => LQ_RX.test(m))) return true;
  return LQ_RX.test(line.psn ?? "") || LQ_RX.test(line.packaging ?? "");
}

/** Page completeness from "page X of N": complete only when a single page or when page===of on the last one. */
export function pageComplete(bol: BolFields): boolean {
  const { page, of } = bol.pageInfo;
  if (of == null) return true; // no multi-page marker → treat as complete (nothing to reconcile)
  if (of <= 1) return true;
  return page != null && page === of; // a real multi-page set needs all pages; caller counts documents
}
