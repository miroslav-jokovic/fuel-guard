import type { DocumentProfileId, FieldEvidence, ShippingDocument } from "@silvicom/shared";
import { hmtEvidence } from "./hmtWitness.js";

/**
 * Each profile's witnesses (§7B, D-DR19), keyed by profile so a new profile without an entry is a type
 * error. The module stays free of trucking words (D-DR1): the shipping document's table witness lives
 * beside it here, as its prompt lives in prompts.ts. A read's `evidence` is exactly this, computed from the
 * read's document — for a cache hit too, so a replayed result carries today's rule, never a stale verdict.
 */
export const EVIDENCE_FOR = {
  shipping_document: (doc: unknown, ruleVersion: string) => hmtEvidence((doc as ShippingDocument).hazmat?.lines ?? [], ruleVersion),
} as const satisfies Record<DocumentProfileId, (doc: unknown, ruleVersion: string) => FieldEvidence[]>;
