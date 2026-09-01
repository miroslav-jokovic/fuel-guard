import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@silvicom/shared";

/**
 * Taking a filed document and its certification back OUT of the compliance record.
 *
 * ── THE ONE THING `RETENTION_FORBIDDEN` ACTUALLY PERMITS ───────────────────────────────────────
 * `documents` and `certifications` are append-only: corrections are new rows, retention rules may
 * never prune them, and nothing in this repository deletes from them as a side effect of anything.
 * The rule as written has always had exactly one exception — *"deletions are explicit audited
 * service-role acts"* — and until now nothing exercised it, so the exception existed only as a
 * sentence.
 *
 * This is that act, given a name and a single door. It exists because the owner asked for a hard
 * delete on annual inspections (D-AVI29) and the alternative was raw SQL against production: no org
 * scoping, no audit, no chance of the storage object going with the row.
 *
 * ── IT DOES NOT WRITE THE AUDIT ROW, AND THAT IS ON PURPOSE ────────────────────────────────────
 * The caller does, BEFORE calling this — while the record still exists to be described. An audit
 * written in here could only ever describe the deletes that already succeeded, which is the account
 * you least need. The caller also holds the reason, which is the part worth keeping.
 *
 * ── STORAGE BEFORE THE ROW ─────────────────────────────────────────────────────────────────────
 * A `documents` row whose object is already gone is a broken link somebody can find and fix. An
 * object whose row is gone is unreachable by every reader in the system and surfaces only as a
 * storage bill. So the object goes first, and a failure there stops the row from going at all.
 */

export type RetractError = { error: string; code: string };

export interface RetractInput {
  /** The filed PDF, or null when the record never had one (an abandoned draft). */
  documentId: string | null;
  /** The compliance fact the document backed, or null when none was ever filed. */
  certificationId: string | null;
}

export interface Retracted {
  documentDeleted: boolean;
  certificationDeleted: boolean;
  /** The object key that was removed, so the caller can report what left the bucket. */
  storagePath: string | null;
}

/** The object key behind a filed document — read before anything is destroyed, so a caller can put
 *  it in its audit row while it is still true. */
export async function filedDocumentPath(
  admin: SupabaseClient,
  orgId: string,
  documentId: string | null,
): Promise<string | null | RetractError> {
  if (!documentId) return null;
  const { data, error } = await admin
    .from("documents")
    .select("storage_path")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  if (error) return { error: "Could not read the filed document", code: "db_error" };
  return data ? ((data as { storage_path: string | null }).storage_path ?? null) : null;
}

export async function retractFiledEvidence(
  admin: SupabaseClient,
  orgId: string,
  input: RetractInput,
): Promise<Retracted | RetractError> {
  let storagePath: string | null = null;

  if (input.certificationId) {
    const { error } = await admin
      .from("certifications")
      .delete()
      .eq("org_id", orgId)
      .eq("id", input.certificationId);
    if (error) return { error: "Could not remove the certification", code: "delete_failed" };
  }

  if (input.documentId) {
    const path = await filedDocumentPath(admin, orgId, input.documentId);
    if (path !== null && typeof path !== "string") return path;
    storagePath = path;
    if (storagePath) {
      const { error } = await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
      // A missing object is not a failure — it means a previous attempt got this far. Anything else
      // stops here, because deleting the row would strand the file.
      if (error && !/not\s*found/i.test(error.message)) {
        return { error: "Could not remove the filed PDF from storage", code: "storage_failed" };
      }
    }
    const { error } = await admin.from("documents").delete().eq("org_id", orgId).eq("id", input.documentId);
    if (error) return { error: "Could not remove the filed document", code: "delete_failed" };
  }

  return {
    documentDeleted: Boolean(input.documentId),
    certificationDeleted: Boolean(input.certificationId),
    storagePath,
  };
}
