import { z } from "zod";

/**
 * ShippingDocument — the `shipping_document` profile's contract (DOCUMENT-READER-PLAN.md §2, D-DR1/D-DR2):
 * everything the document reader transcribes from a bill of lading at pickup or a signed copy at delivery.
 *
 * DATA ONLY, AS PRINTED. Every value is the paper's text or number, never an interpretation (D1 of the
 * hazmat plan: AI reads, code decides). A date is the printed string, a party is the printed name, an id
 * is "NA 1993" if that is what the shipper wrote. Resolution against the HMT, unit normalisation, order
 * matching and the paper audit (§5) all happen downstream, in code, over this shape. Nothing here says
 * whether a value is right — that is the `FieldEvidence` beside it (`fieldEvidenceContract.ts`).
 *
 * WHY EVERY FIELD DEFAULTS TO NULL. One schema serves three writers that each fill a different subset: the
 * model passes (structured output, D-DR8), the corpus labellers (`labels.json`, Step 0.3) and, later, the
 * text-layer reader. `shippingDocumentSchema.parse({})` is therefore the empty document, and the corpus
 * skeleton is derived from it (`emptyShippingDocument`) rather than restated.
 *
 * The hazmat section's line shape is the one the hazmat extractor has validated since H6 (`BolFields` in
 * `apps/api/.../bolFields.ts`, which now imports it from here): same keys, same defaults, so `BolFields`
 * is a projection of this document and its tests run unchanged against it (plan Step 1.1).
 */

const str = () => z.string().nullable().default(null);
const num = () => z.number().nullable().default(null);
const int = () => z.number().int().nullable().default(null);

// ── hazmat: the printed basic description, one entry per line (§172.202) ───────────────────────────
export const printedHazmatLineSchema = z.object({
  /** The id exactly as printed ("UN1203", "NA 1993", "1203"). */
  idText: str(),
  psn: str(),
  /** As printed: "3", "3 (6.1)", "Combustible liquid". */
  hazardClass: str(),
  pg: z.enum(["I", "II", "III"]).nullable().default(null),
  /** The G-entry appended technical name (§172.203(k)), if printed separately. */
  technicalName: str(),
  /** Quantity as printed, with its printed unit string (normalised later). */
  quantity: z.object({ value: num(), unit: str() }).default({ value: null, unit: null }),
  grossWeightLb: num(),
  packageCount: int(),
  /** Per-package weight as printed (enables the count × per-package = extended-weight arithmetic check). */
  perPackageWeightLb: num(),
  /** Packaging phrase as printed ("1 cargo tank", "10 drums", "cases"). */
  packaging: str(),
  /** HM-column mark as printed: "X" (hazmat) or "RQ" (reportable quantity). §172.201(a)(1)(i). */
  hmColumnMark: z.enum(["X", "RQ"]).nullable().default(null),
  /** Marks printed on the line/package ("MARINE POLLUTANT", "LIMITED QUANTITY", "HOT"). */
  marks: z.array(z.string()).default([]),
});
export type PrintedHazmatLine = z.infer<typeof printedHazmatLineSchema>;

const pageOfSchema = z.object({ page: int(), of: int() });

/** A party as printed. Address is one string — split into parts only when a consumer needs them. */
const partySchema = z.object({ name: str(), address: str() }).nullable().default(null);

export const shippingDocumentSchema = z.object({
  identity: z
    .object({
      bolNumber: str(),
      /** The shipping date as printed; parsing it is a consumer's job, against the paper's own format. */
      date: str(),
      /** "Page n of m"; null when the paper prints no marker. */
      pageOf: pageOfSchema.nullable().default(null),
    })
    .default({ bolNumber: null, date: null, pageOf: null }),
  parties: z
    .object({ shipper: partySchema, consignee: partySchema, billTo: partySchema })
    .default({ shipper: null, consignee: null, billTo: null }),
  /** Reference numbers by kind, each as printed. A paper often carries several of one kind. */
  references: z
    .object({
      po: z.array(z.string()).default([]),
      customer: z.array(z.string()).default([]),
      consignee: z.array(z.string()).default([]),
    })
    .default({ po: [], customer: [], consignee: [] }),
  freight: z
    .object({
      pieces: int(),
      pallets: int(),
      /** The printed load total with its own unit — never converted here (plan §6: "never converted silently"). */
      weight: num(),
      weightUnit: z.enum(["lb", "kg"]).nullable().default(null),
      seals: z.array(z.string()).default([]),
      trailer: str(),
    })
    .default({ pieces: null, pallets: null, weight: null, weightUnit: null, seals: [], trailer: null }),
  hazmat: z
    .object({
      lines: z.array(printedHazmatLineSchema).default([]),
      /** §172.604 emergency-response phone, digits as printed. */
      emergencyPhone: str(),
      /** §172.204 shipper's certification present on the paper; null = could not tell. */
      shipperCertification: z.boolean().nullable().default(null),
      offeror: str(),
    })
    .default({ lines: [], emergencyPhone: null, shipperCertification: null, offeror: null }),
  /** The delivery half: what the receiver wrote on the signed copy (Phase 6.2's stop readiness). */
  execution: z
    .object({
      receiverSignaturePresent: z.boolean().nullable().default(null),
      receiverName: str(),
      /** Delivery date/time as printed. */
      deliveredAt: str(),
      /** Over, short and damaged notations, each as written ("2 PCS SHORT", "WRAP TORN"). */
      osdNotations: z.array(z.string()).default([]),
    })
    .default({ receiverSignaturePresent: null, receiverName: null, deliveredAt: null, osdNotations: [] }),
});
export type ShippingDocument = z.infer<typeof shippingDocumentSchema>;

export function emptyShippingDocument(): ShippingDocument {
  return shippingDocumentSchema.parse({});
}

/** Bumped on any change to the schema above; stored on every read and in the cache key (§4.6). */
export const SHIPPING_DOCUMENT_PROFILE_VERSION = "1.0.0";

// ── field criticality (D-DR5) ──────────────────────────────────────────────────────────────────────
/**
 * The hazmat line keys that feed the placard engine — D-DR5's "engine inputs": id, PSN, class, PG,
 * quantity, weight, packaging, LQ, RQ, marine pollutant. LQ and marine pollutant are read from `marks`
 * (`lineDeclaresLq`), RQ from `hmColumnMark`. `technicalName` and `perPackageWeightLb` are audit and
 * arithmetic inputs, not engine inputs, so they graduate at the ordinary bar.
 */
export const ENGINE_INPUT_LINE_KEYS = [
  "idText", "psn", "hazardClass", "pg", "quantity", "grossWeightLb", "packageCount", "packaging",
  "hmColumnMark", "marks",
] as const satisfies readonly (keyof PrintedHazmatLine)[];

export type FieldCriticality = "engine" | "standard";

/**
 * Which bar a field path graduates at. Paths are `fieldEvidenceContract.ts`'s (`hazmat.lines[2].psn`,
 * `hazmat.lines[0].quantity.value`): anything under an engine key of a hazmat line is `engine`.
 */
export function shippingFieldCriticality(path: string): FieldCriticality {
  const m = /^hazmat\.lines\[\d+\]\.([A-Za-z]+)/.exec(path);
  return m && (ENGINE_INPUT_LINE_KEYS as readonly string[]).includes(m[1]!) ? "engine" : "standard";
}

/**
 * D-DR5's graduation bars: consecutive confirmations with zero corrections, under one rule version,
 * before a field may move from Check to Read. Rule of three — zero errors in N puts the 95 % upper bound
 * on the false-accept rate at ≈ 3/N, so 300 → ≤ 1 % and 600 → ≤ 0.5 %. Q-DR8 makes them the owner's.
 */
export const GRADUATION_MIN_CONFIRMATIONS: Readonly<Record<FieldCriticality, number>> = {
  engine: 600,
  standard: 300,
};
