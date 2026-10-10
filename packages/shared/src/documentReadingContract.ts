import { z } from "zod";
import { fieldEvidenceSchema, fieldPathSchema, leafFieldPaths, parseFieldPath } from "./fieldEvidenceContract.js";
import {
  SHIPPING_DOCUMENT_PROFILE_VERSION,
  SHIPPING_DOCUMENT_SECTIONS,
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
 * Who made a document assembly — "these pages, in this order, are one document" (D-DR14, 0454): Layer 1's
 * proposal, the order a person uploaded in, or a person's edit (untick, reorder, add a page).
 */
export const ASSEMBLY_MAKERS = ["prepare", "sender", "reviewer"] as const;
export type AssemblyMaker = (typeof ASSEMBLY_MAKERS)[number];
/**
 * The most pages one assembly may hold. Twenty is the vision API's many-image threshold: above it, every
 * image in the request is held to 2,000 px a side, so a longer document would be read at a lower
 * resolution than a shorter one (D-DR16; the API's `MANY_IMAGES_THRESHOLD`, model/visionTier.ts, which a
 * test holds this at or below). A BOL is one to three pages; twenty leaves room for retakes.
 */
export const ASSEMBLY_MAX_PAGES = 20;

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
  // Step 1.6 (0451). The queue retries a transient model error with backoff; this is the read the last
  // retry left — without it the read would sit in `reading` forever with nobody told.
  model_unavailable: "The reading service could not be reached after several tries. Start the read again.",
  // Step 1.6 (0451). The consumer's module was switched off for the organization (entitlement or the
  // module's kill switch) between the read being queued and a worker reaching it.
  reading_disabled: "Document reading is turned off for this organization.",
} as const satisfies Record<string, string>;
export type ReadFailureCode = keyof typeof READ_FAILURES;
export const READ_FAILURE_CODES = Object.keys(READ_FAILURES) as ReadFailureCode[];

/**
 * Whose failure each code is (owner's ruling, 2026-10-09). A `reader` failure is the reader's
 * performance — the model refused, ran out of room, answered in the wrong shape, or could not see a
 * readable page — so a human must key every field, and `doc:score` counts every labelled field of that
 * document as not read (BOL-READING-RELIABILITY-PLAN's yield: "fields `accepted` without a human"). An
 * `operational` failure is ours — the budget ran out, or the stored bytes changed — and says nothing about
 * how well the reader reads, so `doc:score` leaves the document out of the four numbers and counts it apart.
 * One definition: the scorer derives both groups from here, and the `satisfies` makes a new code without
 * a kind a type error.
 */
export const READ_FAILURE_KIND = {
  refusal: "reader",
  max_tokens: "reader",
  schema_invalid: "reader",
  unusable_image: "reader",
  no_readable_page: "reader",
  budget_exhausted: "operational",
  integrity_mismatch: "operational",
  model_unavailable: "operational",
  reading_disabled: "operational",
} as const satisfies Record<ReadFailureCode, "reader" | "operational">;
export type ReadFailureKind = (typeof READ_FAILURE_KIND)[ReadFailureCode];

/** Why intake refused a file before any read (§3). Each names the limit, so the sender can fix it. */
export const INTAKE_REFUSALS = {
  unsupported_format: "Only PDF, JPEG, PNG, WebP and HEIC files can be read.",
  decode_failed: "This file could not be opened as an image or a PDF.",
  too_small: "The image is too small to read — its long edge must be at least 1200 pixels.",
  too_large: "The file is larger than 25 MB.",
  too_many_pages: "The PDF has more than 10 pages.",
  encrypted_pdf: "The PDF is password-protected.",
  // The two below are the upload channel's, not the file's: a signed-URL upload that never arrived, and
  // bytes whose SHA-256 is not the one announced when the upload was registered (a truncated PUT, or a
  // different file sent to the same URL). Either way the sender's fix is the same — send it again.
  upload_missing: "The file never arrived — upload it again.",
  hash_mismatch: "The file that arrived is not the one that was announced — upload it again.",
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
/**
 * One read request's share of a profile (Q-DR11): a name and its FIELD GROUPS, each a dotted path of
 * object keys into the profile schema ("identity", "hazmat.lines"). No indexes — a list is one group.
 */
export interface DocumentSection {
  name: string;
  groups: readonly string[];
}

export interface DocumentProfile {
  version: string;
  schema: z.ZodObject;
  /**
   * Present when the profile cannot be read as one strict structured output: each section is one
   * request (`readSections`), its schema derived by `sectionSchema`. Absent, the profile is read whole.
   */
  sections?: readonly DocumentSection[];
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
    sections: SHIPPING_DOCUMENT_SECTIONS,
    empty: emptyShippingDocument,
    criticality: shippingFieldCriticality,
  },
} as const satisfies Record<string, DocumentProfile>;
export type DocumentProfileId = keyof typeof DOCUMENT_PROFILES;
export const DOCUMENT_PROFILE_IDS = Object.keys(DOCUMENT_PROFILES) as [DocumentProfileId, ...DocumentProfileId[]];

// ── sections (Q-DR11) ──────────────────────────────────────────────────────────────────────────────
type GroupTree = { [key: string]: GroupTree | true };

/** Group paths → a key tree. Refuses an index, a duplicate, or one group nested inside another. */
function groupTree(groups: readonly string[]): GroupTree {
  const root: GroupTree = {};
  for (const g of groups) {
    const keys = parseFieldPath(g);
    if (keys.some((k) => typeof k === "number")) throw new Error(`section group ${g} has an index`);
    let node = root;
    keys.forEach((k, i) => {
      const at = node[k as string];
      const last = i === keys.length - 1;
      if (at === true || (at !== undefined && last)) throw new Error(`section group ${g} overlaps another`);
      if (last) node[k as string] = true;
      else node = (node[k as string] ??= {}) as GroupTree;
    });
  }
  return root;
}

function pickGroups(schema: z.ZodType, tree: GroupTree, at: string): z.ZodObject {
  const obj = schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodType) : schema;
  if (!(obj instanceof z.ZodObject)) throw new Error(`section group ${at || "(root)"} is not an object`);
  const shape: Record<string, z.ZodType> = {};
  for (const [key, sub] of Object.entries(tree)) {
    const field = obj.shape[key] as z.ZodType | undefined;
    if (!field) throw new Error(`section group ${at}${key} is not a field of the profile`);
    if (sub === true) {
      shape[key] = field;
      continue;
    }
    const picked = pickGroups(field, sub, `${at}${key}.`);
    // A partly-taken object keeps the profile's "defaults to empty", so `{}` still parses.
    shape[key] = field instanceof z.ZodDefault ? picked.default(() => picked.parse({})) : picked;
  }
  return z.object(shape);
}

function sectionOf(profile: DocumentProfile, name: string): DocumentSection {
  const section = profile.sections?.find((s) => s.name === name);
  if (!section) throw new Error(`profile ${profile.version} has no section ${name}`);
  return section;
}

/**
 * Pure: one section's Zod schema, DERIVED from the profile's — the profile's own field schemas, picked
 * by the section's groups, never restated. The wire schema generated from it is what one request sends.
 */
export function sectionSchema(profile: DocumentProfile, name: string): z.ZodObject {
  return pickGroups(profile.schema, groupTree(sectionOf(profile, name).groups), "");
}

/** The sections whose groups own a field path (indexes ignored). A sound profile answers exactly one. */
export function sectionsOwning(profile: DocumentProfile, path: string): string[] {
  const keys = parseFieldPath(path).filter((k) => typeof k === "string");
  return (profile.sections ?? [])
    .filter((s) => s.groups.some((g) => parseFieldPath(g).every((k, i) => keys[i] === k)))
    .map((s) => s.name);
}

const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === "object" && !Array.isArray(v);

function mergeInto(target: Record<string, unknown>, part: Record<string, unknown>, at: string): void {
  for (const [key, value] of Object.entries(part)) {
    const prior = target[key];
    if (prior === undefined) target[key] = JSON.parse(JSON.stringify(value)) as unknown; // parts are JSON answers
    else if (isRecord(prior) && isRecord(value)) mergeInto(prior, value, `${at}${key}.`);
    else throw new Error(`sections overlap at ${at}${key}`);
  }
}

/**
 * Pure: the section answers, keyed by section name, deep-merged into one document and parsed with the
 * profile schema. Refuses a missing or unknown section, a part that writes a field another section owns,
 * and two parts writing the same key — a merge that guessed would be a document nobody read.
 */
export function mergeSections(profile: DocumentProfile, parts: Readonly<Record<string, unknown>>): unknown {
  const names = (profile.sections ?? []).map((s) => s.name);
  if (names.length === 0) throw new Error(`profile ${profile.version} is not read in sections`);
  const unknown = Object.keys(parts).filter((n) => !names.includes(n));
  if (unknown.length) throw new Error(`unknown section ${unknown.join(", ")}`);
  const merged: Record<string, unknown> = {};
  for (const name of names) {
    const part = parts[name];
    if (!isRecord(part)) throw new Error(`section ${name} is missing`);
    const foreign = leafFieldPaths(part).filter((p) => !sectionsOwning(profile, p).includes(name));
    if (foreign.length) throw new Error(`section ${name} writes ${foreign.slice(0, 3).join(", ")}, which it does not own`);
    mergeInto(merged, part, "");
  }
  return profile.schema.parse(merged);
}

// ── routes ─────────────────────────────────────────────────────────────────────────────────────────
const SHA256_RX = /^[0-9a-f]{64}$/;
/** What intake accepts — the browser's picker and its pre-check read this list too (N2). */
export const INTAKE_MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/**
 * `POST /api/documents/sources` — register an upload; the response carries a signed PUT URL.
 *
 * Three calls, because `document_sources` is append-only and its `page_count` is NOT NULL: the row
 * cannot exist until the bytes have been rendered into pages, and they are rendered on the worker,
 * not in the request. So: (1) register → an id and a signed PUT URL, no row; (2) PUT the bytes to
 * Storage directly (they never pass through the API); (3) `POST …/sources/:id/complete` queues the
 * intake, which renders the pages and inserts the source and its pages, then (when asked) the read.
 * `GET …/sources/:id` answers where that stands.
 */
export const createSourceRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  mime: z.enum(INTAKE_MIMES),
  byteSize: z.number().int().positive().max(INTAKE_LIMITS.maxBytes),
  sha256: z.string().regex(SHA256_RX),
});
export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export const createSourceResponseSchema = z.object({
  sourceId: z.uuid(),
  /** Null exactly when `duplicate`: nothing to upload. */
  uploadUrl: z.url().nullable(),
  /** True when this org already holds these exact bytes — no upload needed (D-DR12 dedupe). */
  duplicate: z.boolean(),
});
export type CreateSourceResponse = z.infer<typeof createSourceResponseSchema>;

/** `POST /api/documents/sources/:id/complete` — the bytes are uploaded; render them, and optionally read. */
export const completeSourceRequestSchema = z.object({
  /** The same SHA-256 the registration announced — it names the uploaded object and is checked against its bytes. */
  sha256: z.string().regex(SHA256_RX),
  /** When set, the intake queues a read under this profile as soon as the pages exist. */
  profile: z.enum(DOCUMENT_PROFILE_IDS).nullable().default(null),
});
export type CompleteSourceRequest = z.infer<typeof completeSourceRequestSchema>;
export const completeSourceResponseSchema = z.object({ jobId: z.uuid() });

/**
 * `refused` is the FILE's fault (a refusal code with its sentence); `failed` is ours — the intake job
 * ended in an error that is not about the file (Storage down, the worker died past its retries), so
 * the sender's move is to press complete again, not to change the file. Without it a dead job would
 * poll as `normalising` for ever.
 */
export const SOURCE_STATUSES = ["uploading", "normalising", "ready", "refused", "failed"] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
/** `GET /api/documents/sources/:id` — polled after `complete` until `ready` or `refused`. */
export const sourceStatusResponseSchema = z.object({
  sourceId: z.uuid(),
  status: z.enum(SOURCE_STATUSES),
  /** Set exactly when `refused`; its sentence is `INTAKE_REFUSALS[refusal]`. */
  refusal: z.enum(Object.keys(INTAKE_REFUSALS) as [IntakeRefusalCode, ...IntakeRefusalCode[]]).nullable(),
  pageCount: z.number().int().positive().nullable(),
  /** The read the intake queued (`complete` with a profile), once it exists. */
  readId: z.uuid().nullable(),
});
export type SourceStatusResponse = z.infer<typeof sourceStatusResponseSchema>;

/** `POST /api/documents/sources/from-samsara` — copy a Samsara document's photos in (D-DR9). */
export const sourceFromSamsaraRequestSchema = z.object({ samsaraDocumentId: z.string().min(1) });
export const sourceFromSamsaraResponseSchema = z.object({ sourceId: z.uuid(), pageCount: z.number().int() });

/**
 * `POST /api/documents/assemblies` — say which pages, in which order, are one document (D-DR14, 0454).
 *
 *   { sourceIds }            the sender's order: these uploaded files, in this order, each file's pages
 *                            in page order (`made_by = sender`). A single file is a one-file assembly.
 *   { supersedes, pageIds }  a reviewer's edit of an existing assembly — untick, reorder, add a page —
 *                            as the full new page list (`made_by = reviewer`). 409 `edited_elsewhere`
 *                            when someone else already replaced that version.
 */
const idList = (max: number) =>
  z.array(z.uuid()).min(1).max(max).refine((ids) => new Set(ids).size === ids.length, "each id once");
export const createAssemblyRequestSchema = z.union([
  z.strictObject({ sourceIds: idList(ASSEMBLY_MAX_PAGES) }),
  z.strictObject({ supersedes: z.uuid(), pageIds: idList(ASSEMBLY_MAX_PAGES) }),
]);
export type CreateAssemblyRequest = z.infer<typeof createAssemblyRequestSchema>;
export const createAssemblyResponseSchema = z.object({ assemblyId: z.uuid(), pageCount: z.number().int().min(1) });
export type CreateAssemblyResponse = z.infer<typeof createAssemblyResponseSchema>;

/** `POST /api/documents/reads` — queue a read of a source, or of an assembly (0455), under a profile. */
export const createReadRequestSchema = z.union([
  z.strictObject({ sourceId: z.uuid(), profile: z.enum(DOCUMENT_PROFILE_IDS) }),
  z.strictObject({ assemblyId: z.uuid(), profile: z.enum(DOCUMENT_PROFILE_IDS) }),
]);
export type CreateReadRequest = z.infer<typeof createReadRequestSchema>;
export const createReadResponseSchema = z.object({ readId: z.uuid() });

export const readPageSchema = z.object({
  /** The page's place in the document read: its page number in a source, its position in an assembly. */
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
  /** Exactly one of the two is set: what the read was given (0455). */
  sourceId: z.uuid().nullable(),
  assemblyId: z.uuid().nullable(),
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
export const reviewBatchResponseSchema = z.object({ recorded: z.number().int().min(1) });

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
