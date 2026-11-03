import type { SupabaseClient } from "@supabase/supabase-js";
import { mvrReportFindings, mvrReportSchema, type MvrCheckState } from "@silvicom/shared";
import type { Env } from "../../env.js";
import { intakeStoredBytes, readOfBytes } from "../document-reading/index.js";
import { downloadDocumentBytes } from "../evidence/index.js";

/**
 * The AI check of a driving record on the applicant's drawer (HIRING-WORKFLOW-AUDIT §14, OF6b).
 *
 * ── THE SAME FILE, THREE USES ─────────────────────────────────────────────────────────────────
 * The recruiter drops the MVR PDF once. It is registered and uploaded through the hiring-evidence door as
 * the driver's `mvr` scan (`registerHiringEvidenceDocument` — the door the record is filed through anyway), so
 * the bytes the reader reads ARE the bytes the record will cite: `start` downloads them through `evidence`
 * (hash-checked against what was registered) and hands them to the reader under `mvr_report`, inspections'
 * IC10 shape (`intakeStoredBytes`). `read` answers by the same sha256, so no table links them. A second drop of
 * the same bytes is answered from the reader's cache and costs nothing.
 *
 * ── THE VERDICT IS CODE, AND IT IS ADVICE ─────────────────────────────────────────────────────
 * The read is parsed back through the profile's schema (never trusted as-is) and `mvrReportFindings` — pure,
 * shared, one test per rule — says what to check. Nothing here records the MVR; the recruiter does, after
 * reading the findings beside the PDF.
 *
 * ⚠ Every query is org- and driver-scoped: the service role bypasses RLS, and a document id from the request
 * is only trusted once it is this org's, about THIS driver, and filed as an MVR.
 */
export type MvrCheckError = { code: "not_found" | "invalid_request" | "not_uploaded" | "reading_off" | "failed"; message: string };
export const isMvrCheckError = (v: object): v is MvrCheckError => "code" in v && "message" in v;

interface DocRow { id: string; subject_type: string; subject_id: string; kind: string; sha256: string }

async function mvrDocument(admin: SupabaseClient, orgId: string, driverId: string, documentId: string): Promise<DocRow | MvrCheckError> {
  const { data } = await admin
    .from("documents")
    .select("id, subject_type, subject_id, kind, sha256")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  const doc = data as DocRow | null;
  if (!doc) return { code: "not_found", message: "That document is not on file." };
  if (doc.subject_type !== "driver" || doc.subject_id !== driverId || doc.kind !== "mvr") {
    return { code: "invalid_request", message: "That document is not this applicant's driving record." };
  }
  return doc;
}

export async function startMvrCheck(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  userId: string,
  driverId: string,
  documentId: string,
): Promise<{ sha256: string } | MvrCheckError> {
  // The gate's own switch, asked here too so a refused read spends no intake (inspections' pass does the same).
  if (env.MVR_REPORT_READING !== "on") return { code: "reading_off", message: "Reading driving records is switched off." };
  const doc = await mvrDocument(admin, orgId, driverId, documentId);
  if ("code" in doc && "message" in doc) return doc;
  const got = await downloadDocumentBytes(admin, orgId, documentId);
  if (!got.ok) {
    return got.code === "not_uploaded" || got.code === "hash_mismatch"
      ? { code: "not_uploaded", message: "The file has not finished uploading. Drop it again." }
      : { code: "failed", message: got.error };
  }
  const handed = await intakeStoredBytes(admin, env, orgId, { bytes: got.bytes, profile: "mvr_report", requestedBy: userId });
  if (!handed.ok) return { code: "failed", message: handed.error };
  return { sha256: handed.sha256 };
}

export async function readMvrCheck(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  documentId: string,
  today: string,
): Promise<MvrCheckState | MvrCheckError> {
  const doc = await mvrDocument(admin, orgId, driverId, documentId);
  if ("code" in doc && "message" in doc) return doc;
  const read = await readOfBytes(admin, orgId, doc.sha256, "mvr_report");
  if (read.status === "no_source" || read.status === "no_read" || read.status === "queued" || read.status === "reading") {
    return { status: "reading" };
  }
  if (read.status === "failed") return { status: "failed", reason: read.failureCode ?? "failed" };
  const parsed = mvrReportSchema.safeParse(read.result ?? {});
  if (!parsed.success) return { status: "failed", reason: "unreadable_result" };
  const { data: driver } = await admin
    .from("drivers")
    .select("full_name, cdl_number, cdl_state")
    .eq("org_id", orgId)
    .eq("id", driverId)
    .maybeSingle();
  const d = (driver ?? {}) as { full_name?: string | null; cdl_number?: string | null; cdl_state?: string | null };
  return {
    status: "done",
    report: parsed.data,
    findings: mvrReportFindings(parsed.data, { fullName: d.full_name ?? null, cdlNumber: d.cdl_number ?? null, cdlState: d.cdl_state ?? null }, today),
  };
}
