import { z } from "zod";
import { recordId } from "./recordId.js";

/**
 * Compliance master data contract — `/api/compliance/*` (PLAN §3, M1.5).
 *
 * THE TEMPORAL RULE (§3): anything a regulator can ask "what did it say on date X" about is a
 * dated RECORD, not a column. `certifications` = things that expire and renew (auto-superseded,
 * never deleted); `qualification_records` = dated events, append-only; `documents` = the scan
 * behind any record; `compliance_items` = a derived index the dashboard reads.
 *
 * Pure decision logic (§10.6 status, §10.7 retention) lives HERE so the API, the scan job and any
 * UI agree on it and it is unit-testable without a DB.
 */

// ── vocabularies (§3.1, §3.2) — mirror the SQL check constraints exactly ─────────────────────────

export const COMPLIANCE_SUBJECT_TYPES = ["organization", "driver", "tractor", "trailer"] as const;
export const complianceSubjectTypeSchema = z.enum(COMPLIANCE_SUBJECT_TYPES);
export type ComplianceSubjectType = (typeof COMPLIANCE_SUBJECT_TYPES)[number];

export const CERTIFICATION_KINDS = [
  // driver
  "cdl", "medical_card", "endorsement", "hazmat_training", "twic",
  // equipment
  "registration", "annual_inspection", "insurance", "ifta", "irp",
  // equipment, 0490 (UNIT-FILES-PLAN §4): a lease runs to an end date; a permit is issued for a term,
  // its state or kind in `qualifier`
  "lease", "permit",
  // ORGANIZATION (§0.6) — the carrier itself is a compliance subject
  "phmsa_registration", "hazmat_safety_permit", "security_plan",
  "financial_responsibility", "operating_authority",
] as const;
export const certificationKindSchema = z.enum(CERTIFICATION_KINDS);
export type CertificationKind = (typeof CERTIFICATION_KINDS)[number];

/** §172.704(a): hazmat training is FIVE distinct requirements, not one. */
export const HAZMAT_TRAINING_TYPES = [
  "general_awareness", "function_specific", "safety", "security_awareness", "in_depth_security",
] as const;
export const hazmatTrainingTypeSchema = z.enum(HAZMAT_TRAINING_TYPES);
export type HazmatTrainingType = (typeof HAZMAT_TRAINING_TYPES)[number];

export const QUALIFICATION_RECORD_KINDS = [
  "employment_application", "mvr", "annual_mvr_review", "road_test",
  "cdl_equivalency", "previous_employer_inquiry", "previous_employer_response",
  "clearinghouse_full", "clearinghouse_limited", "eldt", "spe_certificate",
  "medical_registry_verification", "drug_test", "alcohol_test", "accident", "psp_report",
  /**
   * §40.305 documentation that a driver completed the return-to-duty process — the ONLY thing that
   * discharges the §40.25(j) obligation an application's admission creates (0237). Restricted as a
   * testing record: it names a drug or alcohol programme violation and the SAP's verdict on it.
   */
  "return_to_duty",
  /**
   * The carrier's page 24, `DRIVER SAFETY TRAINING`, filed after the office-day orientation (0373,
   * ORIENTATION-PLAN.md). Not a §391.51 item — company orientation is not federally mandated — so it
   * is in no DQ requirement list.
   */
  "orientation",
  /**
   * The carrier's DRIVER HANDBOOK, signed at its five places and countersigned (0373/0374,
   * HANDBOOK-SIGNING-PLAN.md). Carrier policy, not a §391.51 item; what makes it a gate is the owner's
   * D-HB5, enforced by the hire, not a DQ requirement.
   */
  "handbook",
  /**
   * The driver's §382.703 consent to the pre-employment FULL query, given in FMCSA's Clearinghouse
   * portal (0376, D-AW5). The carrier never holds the consent itself — the portal does — so the row is
   * the office recording that the portal shows it, dated. A testing record in `auth.ts`, as 0376's two
   * restrictive policies say, and in no DQ requirement list: the full query's own record is the item.
   */
  "clearinghouse_portal_consent",
] as const;
export const qualificationRecordKindSchema = z.enum(QUALIFICATION_RECORD_KINDS);
export type QualificationRecordKind = (typeof QUALIFICATION_RECORD_KINDS)[number];

export const COMPLIANCE_STATUSES = ["valid", "expiring_soon", "expired", "missing", "unknown"] as const;
export const complianceStatusSchema = z.enum(COMPLIANCE_STATUSES);
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/**
 * The subjects `/api/compliance/documents` files and lists. Each paper is answered by the section of
 * its own file — a driver's is `roster`'s, a truck's or trailer's `equipment`'s (`fileSectionFor`,
 * UNIT-FILES-PLAN D-UF5).
 *
 * `organization` joined this list with the `documents` table (0146). It was always implied:
 * `certifications.subject_type` accepts an organization subject, the hazmat gate blocks on org-level
 * certifications, and a PHMSA registration certificate is a scan like any other.
 */
export const COMPLIANCE_DOCUMENT_SUBJECT_TYPES = ["driver", "tractor", "trailer", "load", "organization"] as const;
/**
 * Every subject `documents` admits — mirrors the SQL check constraint exactly (0476, 0484, 0530).
 *
 * `roadside_inspection` (0476, INSPECTION-CHALLENGE-PLAN IC2) is the `safety` section's (D-IC12): its
 * paper is filed and listed only through `/api/roadside-inspections/:id/documents`. It is kept out of
 * the compliance route's list above on purpose — that route answers to `roster` and `equipment`, and
 * neither's reader is a safety reader, so widening its schema would have let one read a citation.
 */
export const DOCUMENT_SUBJECT_TYPES = [
  ...COMPLIANCE_DOCUMENT_SUBJECT_TYPES, "roadside_inspection",
  // 0530 (M10a): an equipment bill's paper, filed against its `equipment_purchases` row and read only
  // through the inventory routes (the `maintenance` section), never the compliance route above.
  "equipment_purchase",
] as const;
export const documentSubjectTypeSchema = z.enum(DOCUMENT_SUBJECT_TYPES);
export type DocumentSubjectType = (typeof DOCUMENT_SUBJECT_TYPES)[number];

export const DOCUMENT_VARIANTS = ["original", "normalized", "thumb"] as const;
export const documentVariantSchema = z.enum(DOCUMENT_VARIANTS);
export type DocumentVariant = (typeof DOCUMENT_VARIANTS)[number];

/**
 * A unit's papers that are proved by the scan alone (0490, UNIT-FILES-PLAN §4). A title never
 * expires, so there is no dated row to record and supersede — the document IS the evidence, and the
 * truck file's `title` item reads it directly.
 */
export const EQUIPMENT_PAPER_ONLY_KINDS = ["title"] as const;

/**
 * What the compliance route files a document as: every certification kind, every qualification-record
 * kind, the equipment papers that need no record, plus `other`. A document is uploaded BEFORE the record that cites it exists — you scan the
 * medical card, then record the certification — so it cannot borrow its parent's kind.
 */
export const COMPLIANCE_DOCUMENT_KINDS = [
  ...CERTIFICATION_KINDS, ...QUALIFICATION_RECORD_KINDS, ...EQUIPMENT_PAPER_ONLY_KINDS, "other",
] as const;
export type ComplianceDocumentKind = (typeof COMPLIANCE_DOCUMENT_KINDS)[number];
/**
 * An inspection's paper (0476, INSPECTION-CHALLENGE-PLAN §3): the officer's copy (D-IC1's cross-check),
 * the ticket, the certified court result (R-ADJ1), and IC4's DataQs packet and correspondence. Filed
 * only against a `roadside_inspection` subject; `roadsideDocumentsContract.ts` says which a person uploads.
 */
export const ROADSIDE_DOCUMENT_KINDS = [
  "roadside_inspection_report", "citation", "court_disposition", "dataqs_packet", "dataqs_correspondence",
  // 0483 (IC11, Q-IC12 (a)): our rendering of FleetPal's repair record, filed with the certification.
  "roadside_repair_record",
] as const;
export type RoadsideDocumentKind = (typeof ROADSIDE_DOCUMENT_KINDS)[number];
/** An equipment bill's scan or PDF (0530, M10a), filed only against an `equipment_purchase` subject. */
export const EQUIPMENT_PURCHASE_DOCUMENT_KINDS = ["equipment_invoice"] as const;
/** Every kind `documents` admits — mirrors the SQL check constraint exactly (0476, 0484, 0490, 0530). */
export const DOCUMENT_KINDS = [
  ...COMPLIANCE_DOCUMENT_KINDS, ...ROADSIDE_DOCUMENT_KINDS, ...EQUIPMENT_PURCHASE_DOCUMENT_KINDS,
] as const;
export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The private Storage bucket the scans live in (migration 0146). Shared so the API that signs the
 *  upload and the browser that PUTs to it cannot drift onto two different names. */
export const DOCUMENTS_BUCKET = "compliance-docs";

/** Scans and photographs only. Anything else is a document management system, which this is not. */
export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
] as const;
export const documentContentTypeSchema = z.enum(DOCUMENT_CONTENT_TYPES);
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

/** Storage key extension per content type — the single place the mapping is decided. */
export const DOCUMENT_EXTENSIONS: Record<DocumentContentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

// ── certifications ───────────────────────────────────────────────────────────────────────────────

/** POST /api/compliance/certifications — insert with automatic supersede (§10.1). */
export const certificationCreateSchema = z
  .object({
    id: recordId(), // client-generated for idempotent replay, matching the repo's document pattern
    subjectType: complianceSubjectTypeSchema,
    subjectId: recordId(),
    kind: certificationKindSchema,
    /** Endorsement letter H/N/X/T/P/S — REQUIRED when kind='endorsement' (H and X are two rows). */
    qualifier: z.string().max(10).nullish(),
    trainingType: hazmatTrainingTypeSchema.nullish(),
    identifier: z.string().max(120).nullish(),
    issuingAuthority: z.string().max(200).nullish(),
    issuedAt: z.string().nullish(),
    effectiveFrom: z.string().nullish(), // defaults to today server-side
    expiresAt: z.string().nullish(),
    trainingProviderName: z.string().max(200).nullish(),
    trainingProviderAddress: z.string().max(400).nullish(),
    trainingMaterials: z.string().max(2000).nullish(),
    trainingCertified: z.boolean().nullish(),
    documentId: recordId().nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .superRefine((v, ctx) => {
    // Mirrors the SQL cert_training_fields check (§172.704(d)): a training row without its provider,
    // certification flag and type is not a lawful training record.
    if (v.kind === "hazmat_training") {
      if (!v.trainingProviderName?.trim())
        ctx.addIssue({ code: "custom", path: ["trainingProviderName"], message: "§172.704(d) requires the training provider's name" });
      if (v.trainingCertified == null)
        ctx.addIssue({ code: "custom", path: ["trainingCertified"], message: "§172.704(d) requires the certification statement" });
      if (!v.trainingType)
        ctx.addIssue({ code: "custom", path: ["trainingType"], message: "§172.704(a) training type is required" });
    }
    if (v.kind === "endorsement" && !v.qualifier?.trim()) {
      ctx.addIssue({ code: "custom", path: ["qualifier"], message: "An endorsement certification needs its letter (H/N/X/T/P/S)" });
    }
    // Subject/kind coherence: the carrier holds org-level certifications (§0.6); people and
    // equipment hold the rest. A CDL on an organization is a data-entry error, catch it at the door.
    const ORG_KINDS: readonly string[] = ["phmsa_registration", "hazmat_safety_permit", "security_plan", "financial_responsibility", "operating_authority", "insurance"];
    if (v.subjectType === "organization" && !ORG_KINDS.includes(v.kind)) {
      ctx.addIssue({ code: "custom", path: ["kind"], message: `'${v.kind}' is not an organization-level certification` });
    }
    if (v.subjectType !== "organization" && ["phmsa_registration", "hazmat_safety_permit", "security_plan", "operating_authority", "financial_responsibility"].includes(v.kind)) {
      ctx.addIssue({ code: "custom", path: ["kind"], message: `'${v.kind}' belongs to the organization, not a ${v.subjectType}` });
    }
  });
export type CertificationCreateRequest = z.infer<typeof certificationCreateSchema>;

export const certificationRowSchema = z.object({
  id: recordId(),
  subject_type: z.string(),
  subject_id: recordId(),
  kind: z.string(),
  qualifier: z.string().nullable(),
  training_type: z.string().nullable(),
  identifier: z.string().nullable(),
  issuing_authority: z.string().nullable(),
  issued_at: z.string().nullable(),
  effective_from: z.string(),
  expires_at: z.string().nullable(),
  training_provider_name: z.string().nullable(),
  training_certified: z.boolean().nullable(),
  superseded_by: recordId().nullable(),
  superseded_at: z.string().nullable(),
  document_id: recordId().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type CertificationRow = z.infer<typeof certificationRowSchema>;

export const certificationCreateResponseSchema = z.object({
  id: recordId(),
  /** The certification this insert automatically superseded, if one was current (§10.1). */
  supersededId: recordId().nullable(),
});
export type CertificationCreateResponse = z.infer<typeof certificationCreateResponseSchema>;

export const certificationListQuerySchema = z.object({
  subjectType: complianceSubjectTypeSchema,
  subjectId: recordId(),
  kind: certificationKindSchema.optional(),
  /** Default false: only current rows. true = the full supersede chain (the temporal model visible). */
  includeHistory: z.coerce.boolean().default(false),
});
export type CertificationListQuery = z.infer<typeof certificationListQuerySchema>;

// ── qualification records (§3.2 — dated events, append-only) ──────────────────────────────────────

/**
 * Kinds only their own ceremony may write — refused on the generic DQ door (APPLICATION-FLOW-V2-PLAN.md
 * A-9). Each is a HIRE GATE or carries provenance the generic form cannot state: a `handbook` or
 * `road_test` typed in here turned the step green with no ceremony behind it, and the hire gate read it.
 * The value is where the office records it instead, said to them in words.
 */
export const CEREMONY_OWNED_KINDS = {
  psp_report: "File a PSP record from the driver's Employment tab — import the PDF you bought, or order one",
  handbook: "The handbook is signed on the applicant's link and countersigned from their Handbook step",
  road_test: "Record a road test from the applicant's Road test step, where the examiner signs the certificate",
  employment_application: "The application is filed by the applicant's own signing, never typed in here",
} as const satisfies Partial<Record<QualificationRecordKind, string>>;

export const qualificationRecordCreateSchema = z.object({
  id: recordId(),
  driverId: recordId(),
  kind: qualificationRecordKindSchema,
  occurredOn: z.string(),
  /** An annual MVR covers occurred_on .. +1y (§3.2). */
  coversUntil: z.string().nullish(),
  result: z.string().max(400).nullish(),
  performedBy: z.string().max(200).nullish(),
  reference: z.string().max(200).nullish(),
  documentId: recordId().nullish(),
  detail: z.record(z.string(), z.unknown()).default({}),
})
  .superRefine((v, ctx) => {
    /**
     * A PSP record cannot be filed through the generic endpoint (0219).
     *
     * The CHECK constraint added there requires `detail.source` on every `psp_report` row, because
     * provenance is what tells a reader whether the row carries structured data or is an unread PDF
     * (P9). This form has no field for it and no way to know the answer, so without this rule the
     * request would reach Postgres, violate the constraint, and come back as a 500 — a database
     * error where the honest answer is "that is not this endpoint's job".
     *
     * The two paths that legitimately write one both state their source and neither comes through
     * here: `/api/recruitment/psp-orders` (ordered) and `/api/recruitment/psp-imports` (portal PDF).
     */
    // A-9: every other ceremony-owned kind is refused for the same reason — see `CEREMONY_OWNED_KINDS`.
    const owner = (CEREMONY_OWNED_KINDS as Partial<Record<string, string>>)[v.kind];
    if (owner) ctx.addIssue({ code: "custom", path: ["kind"], message: owner });
  });
export type QualificationRecordCreateRequest = z.infer<typeof qualificationRecordCreateSchema>;

export const qualificationRecordRowSchema = z.object({
  id: recordId(),
  driver_id: recordId(),
  kind: z.string(),
  occurred_on: z.string(),
  covers_until: z.string().nullable(),
  result: z.string().nullable(),
  performed_by: z.string().nullable(),
  reference: z.string().nullable(),
  document_id: recordId().nullable(),
  detail: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type QualificationRecordRow = z.infer<typeof qualificationRecordRowSchema>;

// ── documents (§3, DQ0) — the scan behind any record ──────────────────────────────────────────────

/**
 * POST /api/compliance/documents — registration, not upload.
 *
 * The bytes never pass through the API. Registration returns a short-lived signed upload URL the
 * client PUTs to directly, exactly as the hazmat capture path does: one round trip through our
 * process for metadata, none for a 20MB scan. The id is client-generated so a retry after a dropped
 * response is a replay, not a duplicate.
 */
/** POST /api/compliance/documents — the compliance route's subjects and kinds only (see above). */
export const documentRegisterSchema = z.object({
  id: recordId(),
  subjectType: z.enum(COMPLIANCE_DOCUMENT_SUBJECT_TYPES),
  subjectId: recordId(),
  kind: z.enum(COMPLIANCE_DOCUMENT_KINDS),
  contentType: documentContentTypeSchema,
  /** Lowercase hex SHA-256 of the bytes about to be uploaded — §390.32(c) integrity evidence. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 must be 64 lowercase hex characters"),
  bytes: z.number().int().positive().nullish(),
  page: z.number().int().min(1).max(50).default(1),
  variant: documentVariantSchema.default("original"),
  /** When the paper was scanned, if known. NOT the upload time, which `created_at` already records. */
  capturedAt: z.string().nullish(),
});
export type DocumentRegisterRequest = z.infer<typeof documentRegisterSchema>;
/**
 * What `registerDocument` files: a register request for any subject and kind `documents` admits. Each
 * route narrows it to its own section's — `documentRegisterSchema` above, `roadsideDocumentRegisterSchema`
 * for an inspection — so the one writer serves both and neither gate widens the other.
 */
export type DocumentRegistration = Omit<DocumentRegisterRequest, "subjectType" | "kind"> & {
  subjectType: DocumentSubjectType;
  kind: DocumentKind;
};

export const documentRegisterResponseSchema = z.object({
  documentId: recordId(),
  storagePath: z.string(),
  uploadUrl: z.string(),
  token: z.string(),
});
export type DocumentRegisterResponse = z.infer<typeof documentRegisterResponseSchema>;

/** GET /api/compliance/documents — the compliance route's subjects only, as its register. */
export const documentListQuerySchema = z.object({
  subjectType: z.enum(COMPLIANCE_DOCUMENT_SUBJECT_TYPES),
  subjectId: recordId(),
  kind: z.enum(COMPLIANCE_DOCUMENT_KINDS).optional(),
});
/** What `listDocuments` reads: any subject, narrowed by the route that asks (as `DocumentRegistration`). */
export type DocumentListQuery = { subjectType: DocumentSubjectType; subjectId: string; kind?: DocumentKind };

export const documentRowSchema = z.object({
  id: recordId(),
  subjectType: documentSubjectTypeSchema,
  subjectId: recordId(),
  kind: z.string(),
  contentType: z.string(),
  bytes: z.number().nullable(),
  sha256: z.string(),
  page: z.number(),
  variant: z.string(),
  capturedAt: z.string().nullable(),
  createdAt: z.string(),
  /** Signed for a few minutes, or null when signing failed. Never a permanent link. */
  url: z.string().nullable(),
  /**
   * Signed URLs for this ORIGINAL's derivatives (plan B4), same TTL, same batch signing call.
   * The list returns one row per original — derivative rows fold into these two fields instead of
   * appearing as siblings, so no consumer ever renders a thumb as if it were a filed document.
   * Null/absent until the `document_derive` job has run (or for PDFs, which have no derivatives).
   */
  thumbUrl: z.string().nullable().optional(),
  normalizedUrl: z.string().nullable().optional(),
});
export type DocumentRow = z.infer<typeof documentRowSchema>;

/**
 * Storage key: `<org>/<subjectType>/<subjectId>/<documentId>.<ext>`.
 *
 * Folder segment 1 is the org id because that is what the bucket's INSERT policy path-scopes on
 * (0146, mirroring 0092). Kept here rather than in the API so a future driver-side uploader derives
 * the identical key instead of a near-miss.
 */
export function documentStoragePath(
  orgId: string, subjectType: DocumentSubjectType, subjectId: string,
  documentId: string, contentType: DocumentContentType,
): string {
  return `${orgId}/${subjectType}/${subjectId}/${documentId}.${DOCUMENT_EXTENSIONS[contentType]}`;
}
