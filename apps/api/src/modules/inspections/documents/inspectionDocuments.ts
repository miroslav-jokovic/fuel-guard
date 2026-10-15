import type { SupabaseClient } from "@supabase/supabase-js";
import { shouldDerive, type DocumentRegisterResponse, type DocumentRow, type RoadsideDocumentRegisterRequest } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import type { Env } from "../../../env.js";
import { dispatchJob } from "../../../queue/dispatch.js";
import { listDocuments, registerDocument, signDocumentDownload } from "../../evidence/index.js";
import type { DbError } from "../read/inspectionsList.js";

/**
 * An inspection's paper — the ticket, the court's result, the officer's copy (INSPECTION-CHALLENGE-PLAN
 * IC2, migration 0476). Filed in `documents` against the subject `roadside_inspection`, only through
 * `evidence`'s `registerDocument` (D-IC12, `inspections -> evidence`): the bucket, the hash, the signed
 * upload and the five-minute signed read are the DQ file's own (0146), not a second copy of them.
 *
 * ── THE INSPECTION MUST BE OURS AND ON THE RECORD ──────────────────────────────────────────────
 * `documents.subject_id` has no FK (polymorphic, 0146), so nothing in the database stops a document
 * being filed against another carrier's inspection id, or one FMCSA has removed. Both reads below ask
 * first, with the same `vanished_at is null` as the page, and answer 404 as the page does.
 *
 * The download asks the same, and then that the document is THIS inspection's: a document id is
 * enough for `signDocumentDownload`, so without the subject check any safety reader could fetch any
 * of the carrier's documents — a medical card — through this route by its id.
 *
 * Append-only like every document: a wrong upload is answered by uploading the right one, never by
 * deleting (0146). The register is audited with the hash, so the ledger says who filed which bytes.
 */

export type InspectionDocumentsOutcome<T> =
  | { ok: true; data: T }
  | { ok: false; status: 404; code: "not_found"; message: string }
  | { error: DbError | { message: string } };

const NOT_FOUND = { ok: false, status: 404, code: "not_found", message: "Roadside inspection not found" } as const;
const NOT_FOUND_DOCUMENT = { ok: false, status: 404, code: "not_found", message: "That document is not on file for this inspection." } as const;

async function inspectionOnRecord(admin: SupabaseClient, orgId: string, inspectionId: string): Promise<boolean | { error: DbError }> {
  const { data, error } = await admin
    .from("roadside_inspections")
    .select("id")
    .eq("org_id", orgId)
    .eq("id", inspectionId)
    .is("vanished_at", null)
    .maybeSingle();
  if (error) return { error };
  return !!data;
}

/** Every document filed against the inspection, newest first, each with a five-minute signed URL. */
export async function listInspectionDocuments(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
): Promise<InspectionDocumentsOutcome<DocumentRow[]>> {
  const found = await inspectionOnRecord(admin, orgId, inspectionId);
  if (typeof found !== "boolean") return found;
  if (!found) return NOT_FOUND;
  const out = await listDocuments(admin, orgId, { subjectType: "roadside_inspection", subjectId: inspectionId });
  if ("code" in out) return { error: { message: out.error } };
  return { ok: true, data: out.rows };
}

/**
 * Register one file and hand back the signed upload; the browser PUTs the bytes straight to Storage.
 * An image is queued for its thumbnail and normalised copy, as the DQ file's uploads are (B3) — a
 * phone's HEIC photo of a ticket is otherwise unreadable in most browsers.
 */
export async function registerInspectionDocument(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  inspectionId: string,
  actorId: string,
  input: RoadsideDocumentRegisterRequest,
): Promise<InspectionDocumentsOutcome<DocumentRegisterResponse>> {
  const found = await inspectionOnRecord(admin, orgId, inspectionId);
  if (typeof found !== "boolean") return found;
  if (!found) return NOT_FOUND;

  const out = await registerDocument(admin, orgId, actorId, {
    ...input,
    subjectType: "roadside_inspection",
    subjectId: inspectionId,
    page: 1,
    variant: "original",
  });
  if ("code" in out) return { error: { message: out.error } };

  await writeAudit(admin, {
    orgId,
    actorId,
    action: "roadside.document_registered",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: { documentId: out.documentId, kind: input.kind, sha256: input.sha256, bytes: input.bytes ?? null },
  });
  // Swallowed like the DQ file's: a missing thumbnail must not fail a filing, and the backfill (B8)
  // catches anything the queue dropped.
  if (shouldDerive(input.contentType)) {
    await dispatchJob(admin, env, "document_derive", {
      orgId,
      payload: { documentId: out.documentId },
      dedupKey: `document_derive:${out.documentId}`,
      requestedBy: actorId,
    }).catch(() => undefined);
  }
  return { ok: true, data: out };
}

/**
 * One of the inspection's documents as a DOWNLOAD — the server-signed attachment the viewer's
 * Download button follows (DQF plan B6). Audited like the DQ file's: reading paper out of the system
 * is worth a ledger line.
 */
export async function signInspectionDocumentDownload(
  admin: SupabaseClient,
  orgId: string,
  inspectionId: string,
  documentId: string,
  actorId: string,
): Promise<InspectionDocumentsOutcome<{ url: string; filename: string }>> {
  const found = await inspectionOnRecord(admin, orgId, inspectionId);
  if (typeof found !== "boolean") return found;
  if (!found) return NOT_FOUND;
  const out = await signDocumentDownload(admin, orgId, documentId);
  if ("code" in out) return out.code === "not_found" ? NOT_FOUND_DOCUMENT : { error: { message: out.error } };
  if (out.subjectType !== "roadside_inspection" || out.subjectId !== inspectionId) return NOT_FOUND_DOCUMENT;
  await writeAudit(admin, {
    orgId,
    actorId,
    action: "roadside.document_downloaded",
    entity: "roadside_inspection",
    entityId: inspectionId,
    meta: { documentId, filename: out.filename },
  });
  return { ok: true, data: { url: out.url, filename: out.filename } };
}
