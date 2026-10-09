import { z } from "zod";
import { fieldEvidenceSchema, fieldPathSchema } from "./fieldEvidenceContract.js";
import {
  SHIPPING_DOCUMENT_PROFILE_VERSION,
  emptyShippingDocument,
  shippingDocumentSchema,
  shippingFieldCriticality,
  type FieldCriticality,
} from "./shippingDocumentContract.js";

/**
 * The document reader's routes, closed vocabularies and profile registry (DOCUMENT-READER-PLAN.md §2).
 *
 * The module knows no trucking vocabulary (D-DR1): what it reads is a PROFILE registered below, and the
 * only profile is `shipping_document`. Each vocabulary here mirrors a CHECK constraint in the module's
 * migration, so the database and the API refuse the same values.
 */

// ── closed vocabularies ────────────────────────────────────────────────────────────────────────────
/** Where a source's bytes came from (D-DR12). Every channel lands in the one `document_sources` table. */
export const DOCUMENT_ORIGINS = ["upload", "samsara", "sms", "email", "driver_scan"] as const;
export type DocumentOrigin = (typeof DOCUMENT_ORIGINS)[number];

/**
 * What a page is, answered before any field is read (D-DR11). A Samsara *BOL, SECURMENT, PLACARDS*
 * submission mixes all of these — the first corpus document's BOL was page 3 of 9 (F-DR11).
 */
export const PAGE_CLASSES = ["bol", "delivery_copy", "placard", "securement", "other"] as const;
export type PageClass = (typeof PAGE_CLASSES)[number];
/** Who set a page's class. A dispatcher's override is a label too (D-DR11). */
export const PAGE_CLASS_SETTERS = ["classifier", "reviewer", "labeller"] as const;
export type PageClassSetter = (typeof PAGE_CLASS_SETTERS)[number];

/**
 * A page's quality as a labeller judges it, so `doc:score` can report every number per band (Step 0.4)
 * and a reader that is perfect on clean paper cannot hide its night-shot failures in an average.
 *   good — flat, lit, every character legible at a glance;
 *   fair — legible with effort: slight curl, shadow or skew, small type;
 *   poor — night, glare, motion blur, fax-of-a-copy, or a fold across printed values (Step 0.2's ≥ 10).
 */
export const PAGE_QUALITY_BANDS = ["good", "fair", "poor"] as const;
export type PageQualityBand = (typeof PAGE_QUALITY_BANDS)[number];

export const READ_STATUSES = ["queued", "reading", "done", "failed"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];

/**
 * A read's terminal failures (§4.7), each with the sentence the dispatcher sees. Transient model errors
 * (429, 5xx, timeout) are NOT here: they rethrow so the queue retries them (§2 Queue).
 */
export const READ_FAILURES = {
  refusal: "The reading model declined to read this document.",
  max_tokens: "The document has more on it than one read can hold; it was not read.",
  schema_invalid: "The reading model's answer did not have the expected shape, so none of it was used.",
  unusable_image: "No page is clear enough to read. Retake the photo flat, in good light, without glare.",
  no_readable_page: "None of the pages is a bill of lading or a signed delivery copy.",
  budget_exhausted: "This month's document-reading budget is used up.",
  integrity_mismatch: "A stored page no longer matches the bytes that were received, so it was not read.",
} as const satisfies Record<string, string>;
export type ReadFailureCode = keyof typeof READ_FAILURES;
export const READ_FAILURE_CODES = Object.keys(READ_FAILURES) as ReadFailureCode[];

/** Why intake refused a file before any read (§3). Each names the limit, so the sender can fix it. */
export const INTAKE_REFUSALS = {
  unsupported_format: "Only PDF, JPEG, PNG, WebP and HEIC files can be read.",
  decode_failed: "This file could not be opened as an image or a PDF.",
  too_small: "The image is too small to read — its long edge must be at least 1200 pixels.",
  too_large: "The file is larger than 25 MB.",
  too_many_pages: "The PDF has more than 10 pages.",
  encrypted_pdf: "The PDF is password-protected.",
} as const satisfies Record<string, string>;
export type IntakeRefusalCode = keyof typeof INTAKE_REFUSALS;

/** The limits the refusals above name — one definition, read by intake and by the sentences' tests. */
export const INTAKE_LIMITS = { maxBytes: 25 * 1024 * 1024, maxPdfPages: 10, minLongEdgePx: 1200 } as const;

export const REVIEW_ACTIONS = ["confirmed", "corrected", "unreadable"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
/** The feature whose screen produced a review — graduation counts are reported per consumer. */
export const REVIEW_CONSUMERS = ["hazmat_calculator"] as const;
export type ReviewConsumer = (typeof REVIEW_CONSUMERS)[number];

// ── profile registry (D-DR1) ───────────────────────────────────────────────────────────────────────
export interface DocumentProfile {
  version: string;
  schema: z.ZodType;
  /** The page classes whose fields this profile reads (D-DR11); every other page is kept, not read. */
  readsPageClasses: readonly PageClass[];
  empty: () => unknown;
  criticality: (path: string) => FieldCriticality;
}

export const DOCUMENT_PROFILES = {
  shipping_document: {
    version: SHIPPING_DOCUMENT_PROFILE_VERSION,
    schema: shippingDocumentSchema,
    readsPageClasses: ["bol", "delivery_copy"],
    empty: emptyShippingDocument,
    criticality: shippingFieldCriticality,
  },
} as const satisfies Record<string, DocumentProfile>;
export type DocumentProfileId = keyof typeof DOCUMENT_PROFILES;
export const DOCUMENT_PROFILE_IDS = Object.keys(DOCUMENT_PROFILES) as [DocumentProfileId, ...DocumentProfileId[]];

// ── routes ─────────────────────────────────────────────────────────────────────────────────────────
const SHA256_RX = /^[0-9a-f]{64}$/;
const INTAKE_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** `POST /api/documents/sources` — register an upload; the response carries a signed PUT URL. */
export const createSourceRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mime: z.enum(INTAKE_MIMES),
  byteSize: z.number().int().positive().max(INTAKE_LIMITS.maxBytes),
  sha256: z.string().regex(SHA256_RX),
});
export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export const createSourceResponseSchema = z.object({
  sourceId: z.uuid(),
  uploadUrl: z.url(),
  /** True when this org already holds these exact bytes — no upload needed (D-DR12 dedupe). */
  duplicate: z.boolean(),
});
export type CreateSourceResponse = z.infer<typeof createSourceResponseSchema>;

/** `POST /api/documents/sources/from-samsara` — copy a Samsara document's photos in (D-DR9). */
export const sourceFromSamsaraRequestSchema = z.object({ samsaraDocumentId: z.string().min(1) });
export const sourceFromSamsaraResponseSchema = z.object({ sourceId: z.uuid(), pageCount: z.number().int() });

/** `POST /api/documents/reads` — queue a read of a source under a profile. */
export const createReadRequestSchema = z.object({ sourceId: z.uuid(), profile: z.enum(DOCUMENT_PROFILE_IDS) });
export type CreateReadRequest = z.infer<typeof createReadRequestSchema>;
export const createReadResponseSchema = z.object({ readId: z.uuid() });

export const readPageSchema = z.object({
  page: z.number().int().min(1),
  pageClass: z.enum(PAGE_CLASSES).nullable(),
  /** Short-lived signed URL of the working copy; bboxes in the evidence are fractions of its size. */
  url: z.url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ReadPage = z.infer<typeof readPageSchema>;

/** `GET /api/documents/reads/:id` — the dispatcher's page polls this until `status` is terminal. */
export const readResponseSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  profile: z.enum(DOCUMENT_PROFILE_IDS),
  profileVersion: z.string(),
  status: z.enum(READ_STATUSES),
  failureCode: z.enum(READ_FAILURE_CODES as [ReadFailureCode, ...ReadFailureCode[]]).nullable(),
  /** The profile document; null until `done`. Parse it with the profile's schema. */
  result: z.json().nullable(),
  evidence: z.array(fieldEvidenceSchema),
  pages: z.array(readPageSchema),
});
export type ReadResponse = z.infer<typeof readResponseSchema>;

export const reviewEntrySchema = z.object({
  path: fieldPathSchema,
  action: z.enum(REVIEW_ACTIONS),
  oldValue: z.json(),
  /** The dispatcher's value. Equal to `oldValue` for `confirmed`, null for `unreadable`. */
  newValue: z.json(),
});
export type ReviewEntry = z.infer<typeof reviewEntrySchema>;

/** `POST /api/documents/reads/:id/reviews` — one batch per Calculate press (plan §6). */
export const reviewBatchRequestSchema = z.object({
  consumer: z.enum(REVIEW_CONSUMERS),
  reviews: z.array(reviewEntrySchema).min(1).max(500),
});
export type ReviewBatchRequest = z.infer<typeof reviewBatchRequestSchema>;

// ── corpus labels (Step 0.3) ───────────────────────────────────────────────────────────────────────
export const labelledPageSchema = z.object({
  /** Path relative to the document's corpus folder, e.g. `pages/3.jpg`. */
  file: z.string().min(1),
  class: z.enum(PAGE_CLASSES).nullable().default(null),
  band: z.enum(PAGE_QUALITY_BANDS).nullable().default(null),
  assignedBy: z.string().nullable().default(null),
});

/**
 * One corpus document's `labels.json`: the `ShippingDocument` as the paper shows it, flat at the top
 * level so a labeller edits one object, plus the per-page class and band and who keyed it. Two keyers
 * on the hazmat section (Q-DR5); a disagreement is resolved and noted in `notes`, never averaged.
 */
export const shippingDocumentLabelsSchema = shippingDocumentSchema.extend({
  labelledBy: z.array(z.string()).default([]),
  pages: z.array(labelledPageSchema),
  notes: z.string().default(""),
});
export type ShippingDocumentLabels = z.infer<typeof shippingDocumentLabelsSchema>;

/** The unlabelled skeleton the corpus tool writes beside each document's pages. */
export function shippingDocumentLabelsSkeleton(pageFiles: readonly string[]): ShippingDocumentLabels {
  return shippingDocumentLabelsSchema.parse({ pages: pageFiles.map((file) => ({ file })) });
}
