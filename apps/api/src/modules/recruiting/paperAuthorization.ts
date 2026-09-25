import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENT_CONTENT_TYPES, type DocumentContentType, type HiringEvidenceUpload } from "@silvicom/shared";
import { registerDocument } from "../evidence/index.js";

/**
 * A permission signed on paper, and its scan (MV3, D-MVR2).
 *
 * ── WHY THE SCAN IS REQUIRED ──────────────────────────────────────────────────────────────────
 * `POST /authorizations` has accepted `method: "wet_signature"` since 0215, with the scan optional
 * and nothing calling it (Q-HUI6). A wet signature with no paper behind it is the office's word that
 * somebody signed — and the permissions are what make an MVR, a PSP pull and a §391.23 inquiry
 * lawful, so "we say they signed" is the one thing an auditor must never be left holding. Now that
 * the office has a button for it, the scan is required for that method, and it must be a document
 * filed against THIS driver in THIS org: a row citing another person's scan is a cross-contaminated
 * file (`hiringEvidence.ts`'s `checkDocument`, whose reasoning this repeats).
 *
 * ⚠ The scan is filed as kind `other`. A signed release is not one of the §391.51 record kinds, and
 * none of the six is a test RESULT, so no §382.401(a) restriction applies to it.
 */

/** `registerDocument`'s refusal shape — the same local guard `hiringEvidence.ts` uses. */
const isServiceError = (v: unknown): v is { error: string; code: string } =>
  typeof v === "object" && v !== null && "error" in v && "code" in v;

export interface PaperAuthorizationError {
  code: "invalid_request" | "not_found" | "sign_failed" | string;
  message: string;
}

export const isPaperAuthorizationError = (v: unknown): v is PaperAuthorizationError =>
  typeof v === "object" && v !== null && "code" in v && "message" in v;

export async function registerPaperAuthorizationScan(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  driverId: string,
  body: HiringEvidenceUpload,
): Promise<{ documentId: string; uploadUrl: string; token: string; storagePath: string } | PaperAuthorizationError> {
  if (!(DOCUMENT_CONTENT_TYPES as readonly string[]).includes(body.content_type)) {
    return { code: "invalid_request", message: "Upload a PDF or an image (JPEG, PNG, WebP or HEIC)." };
  }
  const { data: driver } = await admin
    .from("drivers")
    .select("id")
    .eq("id", driverId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) return { code: "not_found", message: "That applicant is not in this organization." };

  const registered = await registerDocument(admin, orgId, userId, {
    id: body.document_id,
    subjectType: "driver",
    subjectId: driverId,
    kind: "other",
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

/** Null when the grant may be written; otherwise why not. */
export async function paperScanRefusal(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  method: string,
  documentId: string | null | undefined,
): Promise<PaperAuthorizationError | null> {
  if (!documentId) {
    return method === "wet_signature"
      ? { code: "invalid_request", message: "A paper signature needs the scan of the signed page." }
      : null;
  }
  const { data } = await admin
    .from("documents")
    .select("id, subject_type, subject_id")
    .eq("id", documentId)
    .eq("org_id", orgId)
    .maybeSingle();
  const doc = data as { subject_type: string; subject_id: string } | null;
  if (!doc) return { code: "not_found", message: "That scan is not on file." };
  if (doc.subject_type !== "driver" || doc.subject_id !== driverId) {
    return { code: "invalid_request", message: "That scan belongs to a different driver." };
  }
  return null;
}
