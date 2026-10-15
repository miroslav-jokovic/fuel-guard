import type { DocumentProfileId, FieldEvidence, RoadsideInspectionReport, ShippingDocument } from "@silvicom/shared";
import type { OcrPage } from "./rowWitness.js";
import { roadsideReportEvidence } from "./roadsideReportEvidence.js";
import { shippingEvidence } from "./shippingEvidence.js";

/**
 * Each profile's evidence (§7B, D-DR19), keyed by profile so a new profile without an entry is a type
 * error. The module stays free of trucking words (D-DR1): the shipping document's witnesses live beside it
 * here, as its prompt lives in prompts.ts. `b` is the second reader's document, or null when it produced
 * none; `ocr` the read pages' OCR text (ocr/pageOcr.ts), or null when there is none; `textLayer` their
 * born-digital text (textLayerWitness.ts), or null unless every read page has one.
 */
export const EVIDENCE_FOR = {
  shipping_document: (a: unknown, b: unknown | null, ruleVersion: string, ocr: readonly OcrPage[] | null, textLayer: readonly OcrPage[] | null) =>
    shippingEvidence(a as ShippingDocument, b as ShippingDocument | null, ruleVersion, ocr, textLayer),
  roadside_inspection_report: (a: unknown, b: unknown | null, ruleVersion: string, ocr: readonly OcrPage[] | null, textLayer: readonly OcrPage[] | null) =>
    roadsideReportEvidence(a as RoadsideInspectionReport, b as RoadsideInspectionReport | null, ruleVersion, ocr, textLayer),
} as const satisfies Record<
  DocumentProfileId,
  (a: unknown, b: unknown | null, ruleVersion: string, ocr: readonly OcrPage[] | null, textLayer: readonly OcrPage[] | null) => FieldEvidence[]
>;
export type { OcrPage } from "./rowWitness.js";
