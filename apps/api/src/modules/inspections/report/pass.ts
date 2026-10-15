import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { intakeStoredBytes, type StoredBytesOutcome } from "../../document-reading/index.js";
import { downloadDocumentBytes, listFiledDocuments, type DocumentBytes, type FiledDocumentRef } from "../../evidence/index.js";

/**
 * Hand every filed officer's report to the document reader (INSPECTION-CHALLENGE-PLAN IC10, D-IC13).
 *
 * Runs on the FMCSA hourly tick after the attribution pass. A report is filed on the inspection's
 * Documents card (IC2) — and, once IC12 lands, from the driver's phone — and that card has no "the bytes
 * are here" step: its `documents` row is written when the upload is registered, before the PUT. So rather
 * than a hook on the upload, a pass finds every report not yet handed over, and a file that has not
 * arrived yet is simply found again next hour.
 *
 * Per report: fetch the bytes through `evidence` (hash-checked against what was filed), give them to the
 * reader's intake under the `roadside_inspection_report` profile (`intakeStoredBytes`, the office upload's
 * own path), then record the link. The link is written LAST, so a tick that dies between the two hands
 * the same bytes over again next hour — the reader finds the source by its sha256 and its finished read in
 * its cache, so a repeat costs a queue job and no model spend.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────────────────────────────────
 * It does not compare. What the report says against FMCSA, our units and Samsara's driver is the next
 * step (IC10's second merge), read from the finished read; this pass only makes sure there is one.
 */

/** Reports per tick. A carrier files ~12–30 a month (2026-10-15); this is the backlog's ceiling, not its pace. */
export const REPORTS_PER_TICK = 10;

export interface ReportPassDeps {
  list?: typeof listFiledDocuments;
  download?: (admin: SupabaseClient, orgId: string, documentId: string) => Promise<DocumentBytes>;
  intake?: (admin: SupabaseClient, env: Env, orgId: string, input: Parameters<typeof intakeStoredBytes>[3]) => Promise<StoredBytesOutcome>;
}

export type ReportPassTally = Partial<Record<"handed_over" | "not_uploaded" | "hash_mismatch" | "no_inspection" | "failed", number>>;

/** Paged: PostgREST answers at most 1,000 rows. */
async function linkedDocumentIds(admin: SupabaseClient, orgId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await admin
      .from("inspection_report_reads").select("document_id").eq("org_id", orgId).order("id").range(from, from + 999);
    if (error) throw new Error(`inspection_report_reads: ${error.message}`);
    for (const r of (data ?? []) as { document_id: string }[]) ids.add(r.document_id);
    if ((data ?? []).length < 1_000) return ids;
  }
}

/** The inspections, of those named, that are this org's and still on the record (`vanished_at is null`). */
async function liveInspections(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await admin.from("roadside_inspections").select("id").eq("org_id", orgId).in("id", [...ids]).is("vanished_at", null);
  if (error) throw new Error(`roadside_inspections: ${error.message}`);
  return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
}

export async function readReportBacklog(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  deps: ReportPassDeps = {},
  limit = REPORTS_PER_TICK,
): Promise<ReportPassTally> {
  const tally: ReportPassTally = {};
  const count = (k: keyof ReportPassTally) => (tally[k] = (tally[k] ?? 0) + 1);
  // The switch is the gate's too (report/readGate.ts); asking here as well spends no intake on a read
  // the gate would refuse.
  if (env.ROADSIDE_REPORT_READING !== "on") return tally;

  const list = deps.list ?? listFiledDocuments;
  const download = deps.download ?? downloadDocumentBytes;
  const intake = deps.intake ?? intakeStoredBytes;

  const filed = await list(admin, orgId, { subjectType: "roadside_inspection", kind: "roadside_inspection_report" });
  const linked = await linkedDocumentIds(admin, orgId);
  const due: FiledDocumentRef[] = filed.filter((d) => !linked.has(d.id)).slice(0, limit);
  const live = await liveInspections(admin, orgId, [...new Set(due.map((d) => d.subjectId))]);

  for (const doc of due) {
    if (!live.has(doc.subjectId)) { count("no_inspection"); continue; }
    const got = await download(admin, orgId, doc.id);
    if (!got.ok) {
      if (got.code === "not_uploaded" || got.code === "hash_mismatch") count(got.code);
      else { count("failed"); console.error(`[inspection-report] org ${orgId} document ${doc.id}: ${got.error}`); }
      continue;
    }
    const handed = await intake(admin, env, orgId, { bytes: got.bytes, profile: "roadside_inspection_report", requestedBy: doc.uploadedBy });
    if (!handed.ok) {
      count("failed");
      console.error(`[inspection-report] org ${orgId} document ${doc.id}: ${handed.code} — ${handed.error}`);
      continue;
    }
    const { error } = await admin
      .from("inspection_report_reads")
      .insert({ org_id: orgId, inspection_id: doc.subjectId, document_id: doc.id, sha256: handed.sha256 });
    if (error) { count("failed"); console.error(`[inspection-report] org ${orgId} document ${doc.id}: link — ${error.message}`); continue; }
    count("handed_over");
  }
  return tally;
}
