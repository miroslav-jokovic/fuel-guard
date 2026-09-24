import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTHORIZATION_PURPOSE_LABELS,
  DOCUMENT_CONTENT_TYPES,
  HIRING_RECORDED_ACT_PREREQUISITE,
  hiringEvidenceDetail,
  missingAuthorizations,
  hiringRecordedActKind,
  isHiringRecordedActStep,
  validateHiringEvidence,
  type AuthorizationRow,
  type DocumentContentType,
  type HiringEvidenceFiling,
  type HiringEvidenceUpload,
  type HiringRecordedActStep,
  type QualificationRecordKind,
} from "@silvicom/shared";
import { randomUUID } from "node:crypto";
import { insertQualificationRecord, registerDocument } from "../evidence/index.js";

/**
 * Recording an act performed outside this product — D1, D-HM6, `HIRING-MODULE-PLAN.md` §9.
 *
 * Two calls, the same shape `pspImport.ts` established: register the scan and PUT it to the signed
 * URL, then file the `qualification_records` row that makes it evidence. The bytes never pass
 * through this process.
 *
 * ── WHY THE RECRUITMENT SECTION HAS ITS OWN DOOR ONTO AN EVIDENCE TABLE ───────────────────────
 * `packages/shared/src/hiringEvidence.ts` carries the full argument. The short form: the compliance
 * routes are gated on `roster` manage, a recruiter is `roster: "view"` by RECRUITER-ROLE-SCOPE.md's
 * Option B, and the hiring checklist's lead action for most applicants is *"Order the driving
 * record"*. Without this door the role the board was built for cannot perform step 5 — and the two
 * ways around that (move the affordance to a page they can reach, or widen `roster`) are the two
 * shapes `CLAUDE.md`'s *no workarounds* section names.
 *
 * ⚠ **Nothing is decided here.** Which kind proves which step is `hiringEvidence.ts`'s derivation
 * from D-HM9's catalogue; whether the date is filable is `validateHiringEvidence`; who may file at
 * all is the route's two gates. This module reads rows, calls the evidence module's interface, and
 * says no when the document does not match what it claims to prove.
 *
 * ── EVERY QUERY ORG-FILTERS ITSELF ────────────────────────────────────────────────────────────
 * ⚠ It runs on the service role, which bypasses RLS. Proven by "scopes every read and write to the
 * caller's org" in `routes/hiringEvidence.test.ts`, through `supabaseRecorder`'s `expectOrgScoped`
 * rather than by the review that noticed.
 */

export type HiringEvidenceError = {
  code: string;
  message: string;
  issues?: Array<{ field: string; message: string }>;
};

export interface HiringEvidenceUploadResult {
  documentId: string;
  uploadUrl: string;
  token: string;
  storagePath: string;
}

export interface HiringEvidenceResult {
  recordId: string;
  documentId: string | null;
  kind: QualificationRecordKind;
}

/** Narrow either return without repeating the shape at three call sites (`pspImport.ts`'s helper). */
export const isHiringEvidenceError = (v: object): v is HiringEvidenceError => "code" in v;

const isServiceError = (v: unknown): v is { error: string; code: string } =>
  typeof v === "object" && v !== null && "code" in v && "error" in v;

/**
 * The step, narrowed, together with the kind it files — or a refusal.
 *
 * ⚠ One place, because the two routes must refuse exactly the same set. A step that is not one of
 * D1's three is a 400 rather than a 404: the step key is a path segment, and telling a caller that
 * `psp` is not filable HERE is a different fact from telling them it does not exist.
 *
 * ⚠ It hands back the NARROWED step as well as the kind, so `hiringEvidenceDetail` is reached
 * without a cast. A `step as HiringRecordedActStep` would compile identically today and be the line
 * that lets a widened path segment through on the day the list grows.
 */
function resolveStep(
  step: string,
): { step: HiringRecordedActStep; kind: QualificationRecordKind } | HiringEvidenceError {
  const kind = hiringRecordedActKind(step);
  if (!kind || !isHiringRecordedActStep(step)) {
    return {
      code: "invalid_request",
      message: "That step is not recorded this way.",
    };
  }
  return { step, kind };
}

/**
 * The step's screening prerequisites, or a refusal naming what is missing (AF1, §391.23(a)(1)).
 *
 * ⚠ Read exactly as `pspOrder.ts` reads them — the same four columns, org- AND driver-filtered —
 * and judged by the same `missingAuthorizations` fold, so "may this be recorded" and "may PSP be
 * ordered" can never be answered from two different readings of one person's signatures.
 */
async function prerequisiteRefusal(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  step: HiringRecordedActStep,
): Promise<HiringEvidenceError | null> {
  const call = HIRING_RECORDED_ACT_PREREQUISITE[step];
  if (!call) return null;
  const { data } = await admin
    .from("driver_authorizations")
    .select("id, purpose, accepted_at, revokes")
    .eq("org_id", orgId)
    .eq("driver_id", driverId);
  const missing = missingAuthorizations((data ?? []) as AuthorizationRow[], call);
  if (missing.length === 0) return null;
  return {
    code: "authorization_missing",
    message: `This can't be recorded until the applicant has signed: ${missing
      .map((p) => AUTHORIZATION_PURPOSE_LABELS[p])
      .join(", ")}.`,
  };
}

/** The driver must be this org's before anything else is believed about them. */
async function driverInOrg(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("drivers")
    .select("id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data !== null;
}

/**
 * Step one — register the scan, hand back a signed upload URL.
 *
 * ⚠ The kind is composed from the STEP and never accepted from the caller, for 0217's reason: the
 * kind IS the §382.401(a) read restriction, so a drug-test result registered as `other` would be a
 * drug-test result anybody in the section can open.
 */
export async function registerHiringEvidenceDocument(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  step: string,
  body: HiringEvidenceUpload,
): Promise<HiringEvidenceUploadResult | HiringEvidenceError> {
  const resolved = resolveStep(step);
  if (isHiringEvidenceError(resolved)) return resolved;

  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(body.content_type)) {
    return { code: "invalid_request", message: "Upload a PDF or an image (JPEG, PNG, WebP or HEIC)." };
  }
  if (!(await driverInOrg(admin, orgId, driverId))) {
    return { code: "not_found", message: "That applicant is not in this organization." };
  }
  const unauthorized = await prerequisiteRefusal(admin, orgId, driverId, resolved.step);
  if (unauthorized) return unauthorized;

  const registered = await registerDocument(admin, orgId, userId, {
    id: body.document_id,
    subjectType: "driver",
    subjectId: driverId,
    kind: resolved.kind,
    contentType: body.content_type as DocumentContentType,
    sha256: body.sha256,
    bytes: body.bytes ?? null,
    page: 1,
    variant: "original",
    capturedAt: null,
  });
  if (isServiceError(registered)) return { code: registered.code, message: registered.error };
  return {
    documentId: registered.documentId,
    uploadUrl: registered.uploadUrl,
    token: registered.token,
    storagePath: registered.storagePath,
  };
}

/**
 * Step two — file the act. The row is what turns the checklist's step green, and the fold reads
 * nothing else: `hiringChecklist`'s `evidenceFor` asks whether a kind is present for this driver.
 */
export async function fileHiringEvidence(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  step: string,
  body: HiringEvidenceFiling,
  today: string,
): Promise<HiringEvidenceResult | HiringEvidenceError> {
  const resolved = resolveStep(step);
  if (isHiringEvidenceError(resolved)) return resolved;

  const issues = validateHiringEvidence(body, today);
  if (issues.length > 0) {
    return { code: "invalid_request", message: "That record cannot be filed as it stands.", issues };
  }
  if (!(await driverInOrg(admin, orgId, driverId))) {
    return { code: "not_found", message: "That applicant is not in this organization." };
  }
  const unauthorized = await prerequisiteRefusal(admin, orgId, driverId, resolved.step);
  if (unauthorized) return unauthorized;

  const documentId = body.document_id ?? null;
  if (documentId) {
    const refusal = await checkDocument(admin, orgId, driverId, documentId, resolved.kind);
    if (refusal) return refusal;

    // Filing the same scan twice would put two records of one act in the file, and a §391.51 review
    // COUNTS records. The upload step is already idempotent on the document id; this closes the
    // other half — a retried POST after a dropped response (`filePspImport`'s rule, same hazard).
    const { data: existing } = await admin
      .from("qualification_records")
      .select("id")
      .eq("org_id", orgId)
      .eq("driver_id", driverId)
      .eq("document_id", documentId)
      .maybeSingle();
    if (existing) {
      return { recordId: (existing as { id: string }).id, documentId, kind: resolved.kind };
    }
  }

  const id = randomUUID();
  const inserted = await insertQualificationRecord(admin, orgId, userId, {
    id,
    driverId,
    kind: resolved.kind,
    occurredOn: body.occurred_on,
    // ⚠ No `coversUntil`. All three of D1's acts are `one_time` items in `dqCatalogue.ts`, and the
    // §391.25 annual review is a SEPARATE kind with its own clock — see Q-HM10 (§8, 2026-09-19) for
    // why that clock does not start here and what has to be ruled before it can.
    coversUntil: null,
    result: body.result?.trim() || null,
    performedBy: body.performed_by?.trim() || null,
    reference: body.reference?.trim() || null,
    documentId,
    detail: hiringEvidenceDetail(resolved.step, userId),
  });
  if (isServiceError(inserted)) return { code: inserted.code, message: inserted.error };
  return { recordId: inserted.id, documentId, kind: resolved.kind };
}

/**
 * The cited document must exist, be this org's, be about THIS driver, and carry the step's kind.
 *
 * ⚠ The last two are the ones that matter, and `filePspImport` says why in words worth repeating: a
 * record citing another driver's document is a cross-contaminated file, and a record citing an
 * unrestricted kind is a restricted record whose restriction was decided by whatever the uploader
 * typed. Both are reachable from a client that holds two ids at once.
 */
async function checkDocument(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  documentId: string,
  kind: QualificationRecordKind,
): Promise<HiringEvidenceError | null> {
  const { data } = await admin
    .from("documents")
    .select("id, subject_type, subject_id, kind")
    .eq("id", documentId)
    .eq("org_id", orgId)
    .maybeSingle();
  const doc = data as { subject_type: string; subject_id: string; kind: string } | null;
  if (!doc) return { code: "not_found", message: "That document is not on file." };
  if (doc.subject_type !== "driver" || doc.subject_id !== driverId) {
    return { code: "invalid_request", message: "That document belongs to a different driver." };
  }
  if (doc.kind !== kind) {
    return { code: "invalid_request", message: "That document was not filed for this step." };
  }
  return null;
}
