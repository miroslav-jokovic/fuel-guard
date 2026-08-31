import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENTS_BUCKET,
  documentStoragePath,
  type DocumentKind,
  type DocumentSubjectType,
} from "@silvicom/shared";

/**
 * Filing a document the SERVER produced, rather than one a browser uploaded (plan step A6).
 *
 * ── WHY `registerDocument` COULD NOT BE USED ───────────────────────────────────────────────────
 * `compliance.ts`'s `registerDocument` hands back a signed UPLOAD url so the browser can PUT the
 * bytes straight to Storage — deliberately, so a scan never travels through the API process. A
 * rendered PDF is the opposite case: the API already holds the bytes and there is no browser in the
 * story at all.
 *
 * `recruiting/applicationPdf/file.ts` already does this, and this function is that code generalised
 * rather than copied — the second caller is where a pattern becomes an interface. Its `documents`
 * write stays manifest-pinned until recruiting is next touched (D-ARC4).
 *
 * ── THE HASH IS OF THE BYTES, AND THAT IS THE ONLY PLACE IT CAN BE ─────────────────────────────
 * §390.32(c) wants a filed document reproducible, and `documents.sha256` is what proves the bytes
 * have not moved. The PDF's own footer carries a digest of the SOURCE payload instead, because a
 * file cannot contain its own hash. Two hashes, two different questions: "is this the file we
 * filed" and "was it drawn from these answers".
 */

export interface GeneratedDocumentInput {
  /** Client- or caller-generated, so a retried finalize files onto the same row. */
  id: string;
  subjectType: DocumentSubjectType;
  subjectId: string;
  kind: DocumentKind;
  /** Null when no person filed it — a scheduler, a sync, or a render. `documents.uploaded_by` is nullable for this. */
  uploadedBy: string | null;
  capturedAt?: string | null;
}

export interface FiledDocument {
  documentId: string;
  storagePath: string;
  sha256: string;
  bytes: number;
  /** False when the row already existed — a replay, not a second filing. */
  filed: boolean;
}

export type FileDocumentError = { error: string; code: string };

export async function fileGeneratedDocument(
  admin: SupabaseClient,
  orgId: string,
  input: GeneratedDocumentInput,
  pdf: Buffer,
): Promise<FiledDocument | FileDocumentError> {
  const existing = await admin
    .from("documents")
    .select("id, storage_path, sha256, bytes")
    .eq("org_id", orgId)
    .eq("id", input.id)
    .maybeSingle();
  if (existing.error) return { error: "Could not check the document record", code: "db_error" };
  if (existing.data) {
    const row = existing.data as { id: string; storage_path: string; sha256: string; bytes: number };
    return { documentId: row.id, storagePath: row.storage_path, sha256: row.sha256, bytes: row.bytes, filed: false };
  }

  const path = documentStoragePath(orgId, input.subjectType, input.subjectId, input.id, "application/pdf");
  const upload = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, pdf, { contentType: "application/pdf", upsert: false });
  if (upload.error) return { error: "Could not store the document", code: "storage_failed" };

  const sha256 = createHash("sha256").update(pdf).digest("hex");
  const { error } = await admin.from("documents").insert({
    id: input.id,
    org_id: orgId,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    kind: input.kind,
    storage_path: path,
    content_type: "application/pdf",
    bytes: pdf.byteLength,
    sha256,
    uploaded_by: input.uploadedBy,
    captured_at: input.capturedAt ?? null,
  });
  if (error) return { error: "Could not record the document", code: "insert_failed" };
  return { documentId: input.id, storagePath: path, sha256, bytes: pdf.byteLength, filed: true };
}
