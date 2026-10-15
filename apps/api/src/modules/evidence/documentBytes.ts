import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";

/**
 * A filed document's bytes, for a module that must READ the paper rather than show it (first caller:
 * INSPECTION-CHALLENGE-PLAN IC10, the officer's report handed to the document reader).
 *
 * ── WHY THE HASH IS CHECKED HERE ──────────────────────────────────────────────────────────────────
 * A `documents` row is written when the upload is REGISTERED, before the browser's PUT (compliance.ts),
 * and `sha256` is what the browser announced. So a row can exist with no object yet (`not_uploaded` —
 * the caller tries again later), or with an object that is not the announced file (a truncated PUT,
 * `hash_mismatch`). Bytes that do not hash to the row's `sha256` are not the document that was filed,
 * and reading them would name a driver from a file nobody filed.
 */
export type DocumentBytes =
  | { ok: true; bytes: Buffer; sha256: string }
  | { ok: false; code: "not_found" | "not_uploaded" | "hash_mismatch" | "query_failed"; error: string };

export async function downloadDocumentBytes(admin: SupabaseClient, orgId: string, documentId: string): Promise<DocumentBytes> {
  const { data, error } = await admin
    .from("documents")
    .select("storage_path, sha256")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (error) return { ok: false, code: "query_failed", error: error.message };
  const row = data as { storage_path: string; sha256: string } | null;
  if (!row) return { ok: false, code: "not_found", error: "No such document." };

  const { data: blob, error: dlErr } = await admin.storage.from(DOCUMENTS_BUCKET).download(row.storage_path);
  if (dlErr || !blob) {
    // Only "the object is not there" is the upload's; any other Storage error is ours to retry.
    if (dlErr && !/not.?found|does not exist|404/i.test(dlErr.message)) return { ok: false, code: "query_failed", error: dlErr.message };
    return { ok: false, code: "not_uploaded", error: "The file has not arrived yet." };
  }
  const bytes = Buffer.from(await blob.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== row.sha256) return { ok: false, code: "hash_mismatch", error: "The stored file is not the one that was filed." };
  return { ok: true, bytes, sha256 };
}

/**
 * Every ORIGINAL document of one kind on one subject type, oldest first — the backlog a reading pass
 * walks (IC10: every officer's report filed on any inspection). Derivatives (`normalized`, `thumb`) are
 * renderings of an original and are never read in its place. No signed URLs: the caller wants bytes,
 * through `downloadDocumentBytes`, not a link to show.
 */
export interface FiledDocumentRef {
  id: string;
  subjectId: string;
  sha256: string;
  uploadedBy: string | null;
  createdAt: string;
}

const PAGE = 1_000;

export async function listFiledDocuments(
  admin: SupabaseClient,
  orgId: string,
  q: { subjectType: string; kind: string; subjectId?: string },
): Promise<FiledDocumentRef[]> {
  // Paged: PostgREST answers at most 1,000 rows, and three years of inspections is 1,390 (2026-10-15).
  const rows: { id: string; subject_id: string; sha256: string; uploaded_by: string | null; created_at: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from("documents")
      .select("id, subject_id, sha256, uploaded_by, created_at")
      .eq("org_id", orgId)
      .eq("subject_type", q.subjectType)
      .eq("kind", q.kind)
      .eq("variant", "original")
      .match(q.subjectId ? { subject_id: q.subjectId } : {})
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`documents: ${error.message}`);
    rows.push(...((data ?? []) as typeof rows));
    if ((data ?? []).length < PAGE) break;
  }
  return rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    sha256: r.sha256,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at,
  }));
}
