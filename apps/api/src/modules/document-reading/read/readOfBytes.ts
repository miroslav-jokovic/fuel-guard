import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentProfileId, FieldEvidence, ReadFailureCode, ReadStatus } from "@silvicom/shared";
import { sourceBySha } from "../intake/intake.js";

/**
 * Where the read of some bytes stands, for a consumer that handed them over by `intakeStoredBytes` and
 * kept only their sha256 (INSPECTION-CHALLENGE-PLAN IC10). The source is found by its bytes — two intakes
 * of the same file fold into one source (D-DR12), so the bytes are the stable name, not an id.
 *
 *   `no_source` — intake has not rendered the file yet (or refused it; the intake job says which).
 *   otherwise the NEWEST read of that source under the profile, with its document and evidence once
 *   `done`. No signed page URLs: the consumer compares values, it shows no pages.
 */
export type ReadOfBytes =
  | { status: "no_source" }
  | { status: "no_read"; sourceId: string }
  | {
      status: ReadStatus;
      sourceId: string;
      readId: string;
      failureCode: ReadFailureCode | null;
      result: unknown;
      evidence: FieldEvidence[];
    };

export async function readOfBytes(admin: SupabaseClient, orgId: string, sha256: string, profile: DocumentProfileId): Promise<ReadOfBytes> {
  const source = await sourceBySha(admin, orgId, sha256);
  if (!source) return { status: "no_source" };
  const { data, error } = await admin
    .from("document_reads")
    .select("id, status, failure_code, result, evidence")
    .eq("org_id", orgId)
    .eq("source_id", source.id)
    .eq("profile", profile)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`document_reads: ${error.message}`);
  const row = data as { id: string; status: ReadStatus; failure_code: ReadFailureCode | null; result: unknown; evidence: FieldEvidence[] | null } | null;
  if (!row) return { status: "no_read", sourceId: source.id };
  return { status: row.status, sourceId: source.id, readId: row.id, failureCode: row.failure_code, result: row.result, evidence: row.evidence ?? [] };
}
