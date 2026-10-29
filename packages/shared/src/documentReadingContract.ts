import { z } from "zod";
import { recordId } from "./recordId.js";
import { FORMAT_MIMES, READABLE_FORMATS_TEXT, SOURCE_FORMATS, type SourceFormat } from "./documentFormats.js";
import { fieldEvidenceSchema, fieldPathSchema } from "./fieldEvidenceContract.js";
import {
  SHIPPING_DOCUMENT_PROFILE_VERSION,
  SHIPPING_DOCUMENT_SECTIONS,
  emptyShippingDocument,
  shippingDocumentSchema,
  shippingFieldCriticality,
  type FieldCriticality,
} from "./shippingDocumentContract.js";
import {
  ROADSIDE_INSPECTION_REPORT_PROFILE_VERSION,
  emptyRoadsideInspectionReport,
  roadsideInspectionReportSchema,
  roadsideReportFieldCriticality,
} from "./roadsideInspectionReportContract.js";
import {
  COMPLIANCE_PAPER_PROFILE_VERSION,
  compliancePaperBatchSchema,
  compliancePaperFieldCriticality,
  emptyCompliancePaperBatch,
} from "./compliancePaperContract.js";

/**
 * The document reader's routes, closed vocabularies and profile registry (DOCUMENT-READER-PLAN.md §2).
 *
 * The module knows no trucking vocabulary (D-DR1): what it reads is a PROFILE registered below —
 * `shipping_document`, since 2026-10-15 `roadside_inspection_report` (INSPECTION-CHALLENGE-PLAN IC10), and
 * since 2026-10-21 `compliance_paper` (UNIT-FILES-PLAN UF7b2). Each vocabulary here mirrors a CHECK constraint in the module's
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
 * How far a page must be turned, CLOCKWISE, for its text to read upright (0456, Q-DR19 (a)). The P2
 * classifier answers it beside the class; null on a verdict means "not answered" and the reader turns nothing.
 */
export const PAGE_ROTATIONS = [0, 90, 180, 270] as const;
export type PageRotation = (typeof PAGE_ROTATIONS)[number];
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
 * The stages a read is timed in (TWO-CLICK-READER-PLAN TC0.2, D-TC4; `document_reads.stage_timings`, 0529), in the
 * order they finish: classify the never-seen pages, fetch + size every page, the two readers (asked at once), the
 * OCR witness (on its own thread from the readers' start — its ms is its own run, so `ocr` beyond the slower reader
 * is the time the read waited on it), and the evidence. A cache hit stops after `fetch`. The database holds any
 * object of non-negative numbers; the names are this list's.
 */
export const READ_STAGE_TIMINGS = ["classify", "fetch", "passA", "passB", "ocr", "evidence"] as const;
export type ReadStageTiming = (typeof READ_STAGE_TIMINGS)[number];
export type ReadStageTimings = Partial<Record<ReadStageTiming, number>>;

/**
 * Where a read still running is, as the screen words it — derived from the stages it has FINISHED, which the worker
 * writes as it passes them, never from a clock: `preparing` until the pages are fetched, `reading` while the
 * readers run, `checking` once both have answered and the witnesses are being weighed. Null once the read ended.
 */
export const READ_STAGES = ["preparing", "reading", "checking"] as const;
export type ReadStage = (typeof READ_STAGES)[number];
export function readStageOf(status: ReadStatus, timings: ReadStageTimings | null): ReadStage | null {
  if (status === "done" || status === "failed") return null;
  if (timings?.passA !== undefined) return "checking";
  if (timings?.fetch !== undefined) return "reading";
  return "preparing";
}

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
  // Step 1.6 (0451). The read whose job will never finish it: the last retry of a transient model error,
  // or (since 10/12/2026) a failure no retry mends — a bad key, an empty credit balance. Without it the read
  // sits in `reading` forever with nobody told. Not "after several tries": in-process mode makes one try,
  // and a billing refusal is not a connection problem. The cause is in the job's error, for whoever fixes it.
  model_unavailable: "The reading service is not available right now. Try again in a few minutes; if it keeps happening, tell your administrator.",
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
  unsupported_format: `Only ${READABLE_FORMATS_TEXT} files can be read.`,
  decode_failed: "This file could not be opened as an image or a PDF.",
  too_small:
    "The image is too small to read — its long edge must be at least 800 pixels. Text messages often shrink " +
    "photos; ask the driver to send the original (by email or through the driver app).",
  too_large: "The file is larger than 25 MB.",
  too_many_pages: "The file has more than 10 pages.",
  encrypted_pdf: "The PDF is password-protected.",
  // The two below are the upload channel's, not the file's: a signed-URL upload that never arrived, and
  // bytes whose SHA-256 is not the one announced when the upload was registered (a truncated PUT, or a
  // different file sent to the same URL). Either way the sender's fix is the same — send it again.
  upload_missing: "The file never arrived — upload it again.",
  hash_mismatch: "The file that arrived is not the one that was announced — upload it again.",
} as const satisfies Record<string, string>;
export type IntakeRefusalCode = keyof typeof INTAKE_REFUSALS;

/**
 * The limits the refusals above name — one definition, read by intake and by the sentences' tests.
 *
 * `minLongEdgePx` is MEASURED, not inherited. It was 1200, carried over from the hazmat capture plan, where
 * the driver app owns the camera and 1200 is cheap to demand. Intake does not own the camera: a photo a
 * driver texts arrives as the carrier shrank it, and on 10/13/2026 the owner's Google Voice photo of a BOL
 * (1080 × 810, 119 KB) was refused. Measured that day on the nine readable office BOL samples: each page
 * shrunk to a long edge and re-encoded as JPEG q70 (a carrier's recompression), then OCR'd and compared
 * with the same page's OCR at full resolution (DOCUMENT-READER-PLAN, progress log 2026-10-13). Median
 * digit-token recall was 92% at 1600 px, then flat from 1200 to 800 (77 / 76 / 74 / 77%), then a cliff:
 * 43% at 640 and 13% at 480. 800 is the last size before the cliff. Above it, an unsure value is the
 * readers' to flag (two readers + the OCR witness, §7B) rather than intake's to refuse.
 */
export const INTAKE_LIMITS = { maxBytes: 25 * 1024 * 1024, maxPages: 10, minLongEdgePx: 800 } as const;

export const REVIEW_ACTIONS = ["confirmed", "corrected", "unreadable"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
/**
 * The feature whose screen produced a review — graduation counts are reported per consumer. `hazmat_calculator` is
 * a Calculate press: each field sent, which may be the load's (a typed weight, a product picked from the list).
 * `paper_check` is a person's word on what the PAGE prints, recorded as they give it (0509, Q-RC5) — the only
 * reviews the paper audit takes.
 */
export const REVIEW_CONSUMERS = ["hazmat_calculator", "paper_check"] as const;
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
   * request (`readSections`), its schema derived by `sectionSchema` (`documentSections.ts`). Absent, the profile is read whole.
   */
  sections?: readonly DocumentSection[];
  /** The page classes whose fields this profile reads (D-DR11); every other page is kept, not read. */
  readsPageClasses: readonly PageClass[];
  /**
   * How many models read it: 2 (pass A and pass B, §7B A3) when absent. A profile with ONE reader is
   * read only by its own pin, and its second witness is the person in the review that every one of its
   * reads goes through — `compliance_paper` (UNIT-FILES-PLAN D-UF8), where nothing is filed unseen and a
   * second model's agreement would buy nothing the reviewer does not already give.
   */
  readers?: 1;
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
  // The officer's report (D-IC13). Read WHOLE, not in sections: one or two pages and a few dozen fields.
  // EVERY page class is read, because the classifier's vocabulary is the shipping document's — it can only
  // call a report page `other` — and the person or driver who filed it as `roadside_inspection_report` has
  // already said what it is. The classifier still runs for its other answer, which way is up: a report is
  // most often a phone photo taken sideways in a cab.
  roadside_inspection_report: {
    version: ROADSIDE_INSPECTION_REPORT_PROFILE_VERSION,
    schema: roadsideInspectionReportSchema,
    readsPageClasses: PAGE_CLASSES,
    empty: emptyRoadsideInspectionReport,
    criticality: roadsideReportFieldCriticality,
  },
  // Bulk upload's papers (UNIT-FILES-PLAN UF7b2). Read WHOLE and with ONE reader (D-UF8: a person files
  // every one). Every page class is read for the roadside report's reason — the classifier's vocabulary
  // is the BOL's, so a registration can only be `other` — and the classifier still turns the page upright.
  compliance_paper: {
    version: COMPLIANCE_PAPER_PROFILE_VERSION,
    schema: compliancePaperBatchSchema,
    readsPageClasses: PAGE_CLASSES,
    readers: 1,
    empty: emptyCompliancePaperBatch,
    criticality: compliancePaperFieldCriticality,
  },
} as const satisfies Record<string, DocumentProfile>;
export type DocumentProfileId = keyof typeof DOCUMENT_PROFILES;
export const DOCUMENT_PROFILE_IDS = Object.keys(DOCUMENT_PROFILES) as [DocumentProfileId, ...DocumentProfileId[]];


// ── routes ─────────────────────────────────────────────────────────────────────────────────────────
const SHA256_RX = /^[0-9a-f]{64}$/;
/**
 * The mimes a registration may declare — every format's field names, derived from `FORMAT_MIMES`. The
 * browser sniffs the bytes and declares the canonical one; the rest are accepted because a declaration
 * only feeds the "did the claim match" flag, never the decoder.
 */
type IntakeMimeName = (typeof FORMAT_MIMES)[SourceFormat][number];
export const INTAKE_MIMES = SOURCE_FORMATS.flatMap((f) => FORMAT_MIMES[f]) as [IntakeMimeName, ...IntakeMimeName[]];

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
  sourceId: recordId(),
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
export const completeSourceResponseSchema = z.object({ jobId: recordId() });

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
  sourceId: recordId(),
  status: z.enum(SOURCE_STATUSES),
  /** Set exactly when `refused`; its sentence is `INTAKE_REFUSALS[refusal]`. */
  refusal: z.enum(Object.keys(INTAKE_REFUSALS) as [IntakeRefusalCode, ...IntakeRefusalCode[]]).nullable(),
  pageCount: z.number().int().positive().nullable(),
  /** The read the intake queued (`complete` with a profile), once it exists. */
  readId: recordId().nullable(),
});
export type SourceStatusResponse = z.infer<typeof sourceStatusResponseSchema>;

/** `POST /api/documents/sources/from-samsara` — copy a Samsara document's photos in (D-DR9). */
export const sourceFromSamsaraRequestSchema = z.object({ samsaraDocumentId: z.string().min(1) });
export const sourceFromSamsaraResponseSchema = z.object({ sourceId: recordId(), pageCount: z.number().int() });

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
  z.array(recordId()).min(1).max(max).refine((ids) => new Set(ids).size === ids.length, "each id once");
export const createAssemblyRequestSchema = z.union([
  z.strictObject({ sourceIds: idList(ASSEMBLY_MAX_PAGES) }),
  z.strictObject({ supersedes: recordId(), pageIds: idList(ASSEMBLY_MAX_PAGES) }),
]);
export type CreateAssemblyRequest = z.infer<typeof createAssemblyRequestSchema>;
export const createAssemblyResponseSchema = z.object({ assemblyId: recordId(), pageCount: z.number().int().min(1) });
export type CreateAssemblyResponse = z.infer<typeof createAssemblyResponseSchema>;

/** `POST /api/documents/reads` — queue a read of a source, or of an assembly (0455), under a profile. */
export const createReadRequestSchema = z.union([
  z.strictObject({ sourceId: recordId(), profile: z.enum(DOCUMENT_PROFILE_IDS) }),
  z.strictObject({ assemblyId: recordId(), profile: z.enum(DOCUMENT_PROFILE_IDS) }),
]);
export type CreateReadRequest = z.infer<typeof createReadRequestSchema>;
export const createReadResponseSchema = z.object({ readId: recordId() });

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

/**
 * The printed-paper audit of a finished shipping-document read (§5.1, D-DR6; §7A N6 part 3): one result per
 * rule per line plus the document rules, exactly `auditPrintedPaper`'s answer, worded on screen through
 * `BOL_FINDING_CATALOGUE` (D-DR7). Worked out when the read is fetched, never stored: it follows the
 * dataset and the rules in force, and a stored copy would be a second answer to the same question.
 */
export const paperAuditResultSchema = z.object({
  ruleId: z.string().min(1),
  outcome: z.enum(["pass", "fail", "cannot_tell"]),
  lineIndex: z.number().int().min(0).nullable(),
  reason: z.string().min(1),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string()), z.array(z.number())])),
});
export const paperAuditSchema = z.object({ datasetVersion: z.string(), results: z.array(paperAuditResultSchema) });
export type PaperAuditView = z.infer<typeof paperAuditSchema>;

/** `GET /api/documents/reads/:id` — the dispatcher's page polls this until `status` is terminal. */
export const readResponseSchema = z.object({
  id: recordId(),
  /** Exactly one of the two is set: what the read was given (0455). */
  sourceId: recordId().nullable(),
  assemblyId: recordId().nullable(),
  profile: z.enum(DOCUMENT_PROFILE_IDS),
  profileVersion: z.string(),
  status: z.enum(READ_STATUSES),
  /** Where a read still running is (`readStageOf`); null once it ended. */
  stage: z.enum(READ_STAGES).nullable(),
  failureCode: z.enum(READ_FAILURE_CODES as [ReadFailureCode, ...ReadFailureCode[]]).nullable(),
  /** The profile document; null until `done`. Parse it with the profile's schema. */
  result: z.json().nullable(),
  evidence: z.array(fieldEvidenceSchema),
  pages: z.array(readPageSchema),
  /** The paper audit, for a `done` shipping-document read; null for any other read. */
  paperAudit: paperAuditSchema.nullable(),
});
export type ReadResponse = z.infer<typeof readResponseSchema>;

export const reviewEntrySchema = z.object({
  path: fieldPathSchema,
  action: z.enum(REVIEW_ACTIONS),
  oldValue: z.json(),
  /** The dispatcher's value. Equal to `oldValue` for `confirmed`, null for `unreadable`. */
  newValue: z.json(),
  /**
   * Whether the dispatcher acted on this field — ticked it, picked a reading, or changed it — rather than
   * leaving a prefilled value untouched at Calculate. D-DR5 graduation counts explicit rows only (D-DR24,
   * 0472): a click-through records what was sent without vouching for it.
   */
  explicit: z.boolean(),
});
export type ReviewEntry = z.infer<typeof reviewEntrySchema>;

/** `POST /api/documents/reads/:id/reviews` — one batch per Calculate press (plan §6). */
export const reviewBatchRequestSchema = z.object({
  consumer: z.enum(REVIEW_CONSUMERS),
  reviews: z.array(reviewEntrySchema).min(1).max(500),
});
export type ReviewBatchRequest = z.infer<typeof reviewBatchRequestSchema>;
/** What was recorded, and the paper audit as it now stands, a person's checks taken as the paper's values (Q-RC5). */
export const reviewBatchResponseSchema = z.object({ recorded: z.number().int().min(1), paperAudit: paperAuditSchema.nullable() });

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
