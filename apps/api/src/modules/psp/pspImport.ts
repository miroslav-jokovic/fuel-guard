import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PSP_IMPORT_CONTENT_TYPE,
  PSP_IMPORT_RESULT,
  pspImportDetail,
  validatePspImport,
  type PspImport,
  type PspImportUpload,
} from "@silvicom/shared";
import { registerDocument } from "../evidence/index.js";

/**
 * Importing a PSP record bought on the FMCSA portal — P14, the half of PSP that spends nothing.
 *
 * The API cannot fetch a record we already own (no endpoint lists past transactions, and `/Record`'s
 * `authCode` dies after 120 hours), so a carrier's existing PSP PDFs can only enter the file by
 * being filed. `packages/shared/src/psp/import.ts` holds the reasoning and the rules; this module is
 * the two database acts they authorise.
 *
 * ── WHY THIS IS NOT `POST /api/compliance/documents` PLUS `POST /qualification-records` ─────────
 * Both endpoints exist and between them they could write the same two rows. Three things would be
 * lost, and each is the kind of thing that is only ever noticed afterwards:
 *
 *  1. The compliance router gates on `rolesThatManage("roster")`, and a recruiter has `roster: view`.
 *     The role the recruitment section was created for could not file the evidence it is responsible
 *     for — and widening the compliance router to fix that would hand the whole document surface to
 *     a role deliberately kept out of it.
 *  2. The `kind` would be the client's to choose. `psp_report` is what carries 0217's §391.53(a)(1)
 *     read restriction, so a PDF filed as `other` is a PSP report anyone in the section can open.
 *     Here the kind is composed server-side, the way `DISCLOSURES` is.
 *  3. Nothing would distinguish an import from a purchase, and `detail` would carry whatever the
 *     client sent — including, sooner or later, `inspections: 0` about a driver nobody screened.
 *
 * Every query org-filters itself: this runs as the service role, which bypasses RLS. Pinned by
 * "scopes every read and write to the caller's org".
 */

export type PspImportError = { code: string; message: string; issues?: Array<{ field: string; message: string }> };

export interface PspImportResult {
  recordId: string;
  documentId: string;
}

const isError = (v: unknown): v is { error: string; code: string } =>
  typeof v === "object" && v !== null && "code" in v && "error" in v;

/**
 * Step one — register the PDF, hand back a signed upload URL, and let the browser PUT the bytes
 * straight to Storage. The bytes never pass through this process, which is the rule the compliance
 * path set and the reason a 20 MB scan does not occupy an API worker.
 */
export async function registerPspImportDocument(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  body: PspImportUpload,
): Promise<{ documentId: string; uploadUrl: string; token: string; storagePath: string } | PspImportError> {
  const { data: driver } = await admin
    .from("drivers")
    .select("id")
    .eq("id", body.driver_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) return { code: "not_found", message: "Driver not found" };

  const registered = await registerDocument(admin, orgId, userId, {
    id: body.document_id,
    subjectType: "driver",
    subjectId: body.driver_id,
    // Composed here, never accepted from the caller — the kind IS the read restriction (0217).
    kind: "psp_report",
    contentType: PSP_IMPORT_CONTENT_TYPE,
    sha256: body.sha256,
    bytes: body.bytes ?? null,
    page: 1,
    variant: "original",
    capturedAt: null,
  });
  if (isError(registered)) return { code: registered.code, message: registered.error };
  return {
    documentId: registered.documentId,
    uploadUrl: registered.uploadUrl,
    token: registered.token,
    storagePath: registered.storagePath,
  };
}

/**
 * Step two — cite the uploaded PDF from a `qualification_records` row, which is what makes it
 * evidence rather than a file in a bucket.
 *
 * No `psp_requests` ledger row is written, deliberately. That table is a record of transactions WE
 * made: it settles a status, stores what PSP charged us, and is what a monthly invoice reconciles
 * against. An import is not a transaction — inventing a row for it would put a purchase we never
 * made into the reconciliation, and `billed: false` rows would then have to be filtered out of every
 * count that means "what did PSP cost us".
 */
export async function filePspImport(
  admin: SupabaseClient,
  orgId: string,
  userId: string,
  body: PspImport,
  today: string,
): Promise<PspImportResult | PspImportError> {
  const issues = validatePspImport(body, today);
  if (issues.length > 0) {
    return { code: "invalid_request", message: "That import cannot be filed as it stands.", issues };
  }

  const { data: driver } = await admin
    .from("drivers")
    .select("id")
    .eq("id", body.driver_id)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!driver) return { code: "not_found", message: "Driver not found" };

  // The document must exist, belong to this org, be about THIS driver, and be a `psp_report`. The
  // last two are the ones that matter: a record citing another driver's document is a
  // cross-contaminated file, and a record citing an unrestricted kind is a PSP report whose
  // restriction was decided by whatever the uploader typed.
  const { data: doc } = await admin
    .from("documents")
    .select("id, subject_type, subject_id, kind")
    .eq("id", body.document_id)
    .eq("org_id", orgId)
    .maybeSingle();
  const document = doc as { id: string; subject_type: string; subject_id: string; kind: string } | null;
  if (!document) return { code: "not_found", message: "That document is not on file." };
  if (document.subject_type !== "driver" || document.subject_id !== body.driver_id) {
    return { code: "invalid_request", message: "That document belongs to a different driver." };
  }
  if (document.kind !== "psp_report") {
    return { code: "invalid_request", message: "That document is not filed as a PSP report." };
  }

  // Filing the same PDF twice would put two records of one screening in the file, and a §391.51
  // review counts records. The upload step is already idempotent on the document id; this closes the
  // other half — a retried POST after a dropped response.
  const { data: existing } = await admin
    .from("qualification_records")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", body.driver_id)
    .eq("document_id", body.document_id)
    .maybeSingle();
  if (existing) {
    return { recordId: (existing as { id: string }).id, documentId: body.document_id };
  }

  const { data: record, error } = await admin
    .from("qualification_records")
    .insert({
      org_id: orgId,
      driver_id: body.driver_id,
      kind: "psp_report",
      occurred_on: body.obtained_on,
      // Provenance, not a reading of the report — see PSP_IMPORT_RESULT.
      result: PSP_IMPORT_RESULT,
      reference: body.reference?.trim() || null,
      document_id: body.document_id,
      detail: pspImportDetail(body, userId),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !record) {
    return { code: "insert_failed", message: error?.message ?? "Could not file the imported record." };
  }

  return { recordId: (record as { id: string }).id, documentId: body.document_id };
}

/** Narrow either return without repeating the shape at three call sites. */
export const isPspImportError = (v: object): v is PspImportError => "code" in v;
