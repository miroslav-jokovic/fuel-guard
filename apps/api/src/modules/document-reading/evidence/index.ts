import type { DocumentProfileId, FieldEvidence, ShippingDocument } from "@silvicom/shared";
import { shippingEvidence } from "./shippingEvidence.js";

/**
 * Each profile's evidence (§7B, D-DR19), keyed by profile so a new profile without an entry is a type
 * error. The module stays free of trucking words (D-DR1): the shipping document's witnesses live beside it
 * here, as its prompt lives in prompts.ts. `b` is the second reader's document, or null when it produced
 * none.
 */
export const EVIDENCE_FOR = {
  shipping_document: (a: unknown, b: unknown | null, ruleVersion: string) =>
    shippingEvidence(a as ShippingDocument, b as ShippingDocument | null, ruleVersion),
} as const satisfies Record<DocumentProfileId, (a: unknown, b: unknown | null, ruleVersion: string) => FieldEvidence[]>;
