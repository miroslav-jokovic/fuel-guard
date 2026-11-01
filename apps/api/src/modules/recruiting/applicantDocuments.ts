import type { SupabaseClient } from "@supabase/supabase-js";
import {
  APPLICANT_DOCUMENT_KINDS,
  APPLICANT_DOCUMENT_SLOTS,
  APPLICATION_CAPTURES_BUCKET,
  DOCUMENTS_BUCKET,
  applicantDocumentKind,
  applicantDocumentPage,
  applicantDocumentSlot,
  canReadRestrictedKind,
  canSeePaperImage,
  type ApplicantDocument,
  type ApplicantDocumentUpload,
  type ApplicantDocumentUploadResponse,
  type ApplicationCaptureSlot,
  type DocumentContentType,
  type PromotedCaptureSlot,
  type UserRole,
} from "@silvicom/shared";
import { registerDocument } from "../evidence/index.js";
import { labelOf, memberLabels } from "../../lib/memberLabels.js";

/**
 * The applicant's papers on their record, and the office's upload beside them (HIRING-WORKFLOW-AUDIT-
 * 2026-10-31 §3.5/§4.7, §9 P9).
 *
 * ── WHY THIS IS A RECRUITMENT DOOR AND NOT `/api/compliance/documents` ────────────────────────
 * The audit found the office had no upload on the applicant record; `useUploadDocument` exists and is
 * mounted only on the driver page, behind `/api/compliance/documents`, whose writes answer to `roster:
 * manage`. A recruiter is `roster: view` by RECRUITER-ROLE-SCOPE.md's Option B, so the role the record
 * is built for would be refused — and widening `roster` would hand them the whole roster's writes. So
 * the door is on their own section, as `hiringEvidence.ts` and `pspImport.ts` are, and it composes the
 * kind server-side from the applicant's own list (`applicantDocumentsContract.ts`): a request names a
 * slot, never a kind. The write goes through evidence's `registerDocument`, so no writer is added.
 *
 * ── WHAT THE READ SHOWS ───────────────────────────────────────────────────────────────────────
 * Two sources, one list: the link's captures not yet filed (still in the staging bucket), and the
 * driver's filed `documents` of the kinds the list produces — whether the applicant's capture was
 * promoted into one (`uploaded_by` null) or the office uploaded it. A filed paper whose id is a capture
 * of a drawn mark is left out: the signature and initials pictures file as `other` (no §391.51 kind
 * for a decoration) and are not documents anybody sent.
 *
 * ── Q-WF4: THE ROW, NOT THE PICTURE ───────────────────────────────────────────────────────────
 * An SSN card or a passport is listed for every reader of the record and SIGNED only for a role
 * `canSeePaperImage` allows — the URL is never minted, so no client can show what it was not given.
 *
 * ⚠ The service role bypasses RLS: every query carries `.eq("org_id", …)`, asserted by `expectOrgScoped`.
 */

const URL_TTL_SECONDS = 300;

interface CaptureRow {
  id: string;
  slot: ApplicationCaptureSlot;
  storage_path: string;
  content_type: string;
  captured_at: string;
  promoted_document_id: string | null;
}

interface DocumentRow {
  id: string;
  kind: string;
  page: number | null;
  content_type: string;
  storage_path: string;
  created_at: string;
  uploaded_by: string | null;
}

export type ApplicantDocumentsError = { code: "not_found"; message: string };
export const isApplicantDocumentsError = (v: object): v is ApplicantDocumentsError => "code" in v && "message" in v;

const NOT_FOUND: ApplicantDocumentsError = { code: "not_found", message: "That applicant is not in this organization." };

async function driverInOrg(admin: SupabaseClient, orgId: string, driverId: string): Promise<boolean> {
  const { data } = await admin.from("drivers").select("id").eq("org_id", orgId).eq("id", driverId).maybeSingle();
  return data !== null;
}

/** One Storage batch per bucket; a path that will not sign is a row with no link, never a failed page. */
async function sign(admin: SupabaseClient, bucket: string, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await admin.storage.from(bucket).createSignedUrls(paths, URL_TTL_SECONDS);
  for (const s of (data ?? []) as Array<{ path: string | null; signedUrl: string | null }>) {
    if (s.path && s.signedUrl) out.set(s.path, s.signedUrl);
  }
  return out;
}

const LISTED_SLOTS: ReadonlySet<string> = new Set(APPLICANT_DOCUMENT_SLOTS);

export async function listApplicantDocuments(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  role: UserRole | null,
): Promise<ApplicantDocument[] | ApplicantDocumentsError> {
  if (!(await driverInOrg(admin, orgId, driverId))) return NOT_FOUND;

  const [{ data: captureData }, { data: documentData }] = await Promise.all([
    admin
      .from("application_captures")
      .select("id, slot, storage_path, content_type, captured_at, promoted_document_id")
      .eq("org_id", orgId)
      .eq("driver_id", driverId),
    admin
      .from("documents")
      .select("id, kind, page, content_type, storage_path, created_at, uploaded_by")
      .eq("org_id", orgId)
      .eq("subject_type", "driver")
      .eq("subject_id", driverId)
      .eq("variant", "original")
      .in("kind", [...APPLICANT_DOCUMENT_KINDS]),
  ]);
  const captures = (captureData ?? []) as CaptureRow[];
  const slotOf = new Map(captures.map((c) => [c.id, c.slot]));
  const readable = (kind: string) => canReadRestrictedKind(kind, role);

  // The link's papers still in staging — the list's slots only (never the selfie or a drawn mark).
  const staged = captures.filter(
    (c) => c.promoted_document_id === null && LISTED_SLOTS.has(c.slot)
      && readable(applicantDocumentKind(c.slot as PromotedCaptureSlot)),
  );
  // Filed papers, less the drawn marks that file as `other` under their capture's own id.
  const filed = ((documentData ?? []) as DocumentRow[]).filter((d) => {
    const capturedAs = slotOf.get(d.id);
    return readable(d.kind) && (capturedAs === undefined || LISTED_SLOTS.has(capturedAs));
  });

  const stagedKind = (c: CaptureRow) => applicantDocumentKind(c.slot as PromotedCaptureSlot);
  const [stagedUrls, filedUrls, labels] = await Promise.all([
    sign(admin, APPLICATION_CAPTURES_BUCKET, staged.filter((c) => canSeePaperImage(stagedKind(c), role)).map((c) => c.storage_path)),
    sign(admin, DOCUMENTS_BUCKET, filed.filter((d) => canSeePaperImage(d.kind, role)).map((d) => d.storage_path)),
    memberLabels(admin, orgId, filed.map((d) => d.uploaded_by).filter((u): u is string => typeof u === "string")),
  ]);

  const rows: ApplicantDocument[] = [
    ...staged.map((c): ApplicantDocument => {
      const kind = stagedKind(c);
      const withheld = !canSeePaperImage(kind, role);
      return {
        id: c.id, slot: c.slot, kind, contentType: c.content_type, at: c.captured_at,
        source: "applicant", addedBy: null, staged: true,
        url: withheld ? null : (stagedUrls.get(c.storage_path) ?? null), imageWithheld: withheld,
      };
    }),
    ...filed.map((d): ApplicantDocument => {
      const withheld = !canSeePaperImage(d.kind, role);
      return {
        id: d.id, slot: slotOf.get(d.id) ?? applicantDocumentSlot(d.kind, d.page ?? 1), kind: d.kind,
        contentType: d.content_type, at: d.created_at,
        // `uploaded_by` is null exactly when the link filed it (0376's two filing functions write null).
        source: d.uploaded_by ? "office" : "applicant",
        addedBy: d.uploaded_by ? (labelOf(labels.get(d.uploaded_by)) ?? null) : null,
        staged: false,
        url: withheld ? null : (filedUrls.get(d.storage_path) ?? null), imageWithheld: withheld,
      };
    }),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * Register one paper the office is filing for the applicant; the browser PUTs it to the signed URL
 * (`uploadDocumentFile`'s shape, the same as every document registration). The kind and page come from
 * the slot — `applicantDocumentKind`/`applicantDocumentPage`, the promotion's own table.
 */
export async function registerApplicantDocument(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  body: ApplicantDocumentUpload,
): Promise<(ApplicantDocumentUploadResponse & { kind: string }) | ApplicantDocumentsError | { code: string; message: string }> {
  if (!(await driverInOrg(admin, orgId, driverId))) return NOT_FOUND;
  const kind = applicantDocumentKind(body.slot);
  const registered = await registerDocument(admin, orgId, userId, {
    id: body.document_id,
    subjectType: "driver",
    subjectId: driverId,
    kind,
    contentType: body.content_type as DocumentContentType,
    sha256: body.sha256,
    bytes: body.bytes ?? null,
    page: applicantDocumentPage(body.slot),
    variant: "original",
    capturedAt: null,
  });
  if ("code" in registered) return { code: registered.code, message: registered.error };
  return { ...registered, kind };
}
