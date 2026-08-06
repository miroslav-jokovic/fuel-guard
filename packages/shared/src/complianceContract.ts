import { z } from "zod";

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
  "medical_registry_verification", "drug_test", "alcohol_test", "accident",
] as const;
export const qualificationRecordKindSchema = z.enum(QUALIFICATION_RECORD_KINDS);
export type QualificationRecordKind = (typeof QUALIFICATION_RECORD_KINDS)[number];

export const COMPLIANCE_STATUSES = ["valid", "expiring_soon", "expired", "missing", "unknown"] as const;
export const complianceStatusSchema = z.enum(COMPLIANCE_STATUSES);
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const DOCUMENT_SUBJECT_TYPES = ["driver", "tractor", "trailer", "load"] as const;
export const documentSubjectTypeSchema = z.enum(DOCUMENT_SUBJECT_TYPES);

export const DOCUMENT_VARIANTS = ["original", "normalized", "thumb"] as const;

// ── certifications ───────────────────────────────────────────────────────────────────────────────

/** POST /api/compliance/certifications — insert with automatic supersede (§10.1). */
export const certificationCreateSchema = z
  .object({
    id: z.uuid(), // client-generated for idempotent replay, matching the repo's document pattern
    subjectType: complianceSubjectTypeSchema,
    subjectId: z.uuid(),
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
    documentId: z.uuid().nullish(),
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
  id: z.uuid(),
  subject_type: z.string(),
  subject_id: z.uuid(),
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
  superseded_by: z.uuid().nullable(),
  superseded_at: z.string().nullable(),
  document_id: z.uuid().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type CertificationRow = z.infer<typeof certificationRowSchema>;

export const certificationCreateResponseSchema = z.object({
  id: z.uuid(),
  /** The certification this insert automatically superseded, if one was current (§10.1). */
  supersededId: z.uuid().nullable(),
});
export type CertificationCreateResponse = z.infer<typeof certificationCreateResponseSchema>;

export const certificationListQuerySchema = z.object({
  subjectType: complianceSubjectTypeSchema,
  subjectId: z.uuid(),
  kind: certificationKindSchema.optional(),
  /** Default false: only current rows. true = the full supersede chain (the temporal model visible). */
  includeHistory: z.coerce.boolean().default(false),
});
export type CertificationListQuery = z.infer<typeof certificationListQuerySchema>;

// ── qualification records (§3.2 — dated events, append-only) ──────────────────────────────────────

export const qualificationRecordCreateSchema = z.object({
  id: z.uuid(),
  driverId: z.uuid(),
  kind: qualificationRecordKindSchema,
  occurredOn: z.string(),
  /** An annual MVR covers occurred_on .. +1y (§3.2). */
  coversUntil: z.string().nullish(),
  result: z.string().max(400).nullish(),
  performedBy: z.string().max(200).nullish(),
  reference: z.string().max(200).nullish(),
  documentId: z.uuid().nullish(),
  detail: z.record(z.string(), z.unknown()).default({}),
});
export type QualificationRecordCreateRequest = z.infer<typeof qualificationRecordCreateSchema>;

export const qualificationRecordRowSchema = z.object({
  id: z.uuid(),
  driver_id: z.uuid(),
  kind: z.string(),
  occurred_on: z.string(),
  covers_until: z.string().nullable(),
  result: z.string().nullable(),
  performed_by: z.string().nullable(),
  reference: z.string().nullable(),
  document_id: z.uuid().nullable(),
  detail: z.record(z.string(), z.unknown()),
  created_at: z.string(),
});
export type QualificationRecordRow = z.infer<typeof qualificationRecordRowSchema>;
