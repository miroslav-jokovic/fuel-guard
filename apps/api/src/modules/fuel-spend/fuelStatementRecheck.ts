/**
 * "Check again": re-run the invoice check of a recorded weekly bill from the PDF we kept, with today's reader.
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────────────────────────────
 * A check is a record of what one reader concluded on one day. When the reader improves, nothing revisits
 * the bills already checked: INV-59656 was checked on 2026-11-24 by the first reader of Pilot's 2026-11
 * invoice, which took the period from the line dates (11/16–11/23) and so filed 62 of our 11/23 fills as
 * unbilled (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §5). Re-checking it reads the billing week, supersedes the
 * old run, and the carry-forward closes the old run's leftovers with a note saying so (`fuelReconCarry.ts`).
 *
 * The PDF is read on the server, from the `fuel-statements` bucket, with the same `readPdfWords` the Pilot-Bills
 * pull uses — not re-sent by a browser — so the re-check is of exactly the bytes that were recorded.
 *
 * The statement row itself is not rewritten: it is evidence (append-only, `RETENTION_FORBIDDEN`), and its
 * stored period stays what was recorded. Only the CHECK is new.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readPdfWords } from "../../lib/pdfWords.js";
import { runFuelReconciliation, type ReconRunResult } from "./fuelReconRun.js";
import { STATEMENT_BUCKET } from "./fuelStatementIngest.js";

export type RecheckOutcome =
  | { ok: true; run: ReconRunResult }
  | { ok: false; status: 404 | 409 | 422 | 502; code: string; message: string; tieOutFailures?: string[] };

export async function recheckFuelStatement(
  admin: SupabaseClient,
  orgId: string,
  actorId: string | null,
  statementId: string,
): Promise<RecheckOutcome> {
  const { data, error } = await admin
    .from("fuel_statements")
    .select("id, source_path, source_filename, superseded_by")
    .eq("org_id", orgId)
    .eq("id", statementId)
    .maybeSingle();
  if (error) return { ok: false, status: 502, code: "db_error", message: "Could not load that statement." };
  const st = data as { id: string; source_path: string | null; source_filename: string | null; superseded_by: string | null } | null;
  if (!st) return { ok: false, status: 404, code: "not_found", message: "No statement with that id." };
  if (st.superseded_by) {
    return { ok: false, status: 409, code: "superseded", message: "A newer copy of this invoice was recorded; check that one instead." };
  }
  if (!st.source_path) return { ok: false, status: 409, code: "no_source", message: "No PDF was kept for this statement, so it cannot be checked again." };

  const dl = await admin.storage.from(STATEMENT_BUCKET).download(st.source_path);
  if (dl.error || !dl.data) return { ok: false, status: 502, code: "storage_unavailable", message: "Could not open the stored PDF." };
  const words = await readPdfWords(Buffer.from(await (dl.data as Blob).arrayBuffer()));
  if (!words.ok) return { ok: false, status: 422, code: "unreadable_pdf", message: `The stored PDF could not be read (${words.reason}).` };

  const run = await runFuelReconciliation(admin, orgId, actorId, {
    words: words.words, grid: null, pivotGrid: null, filename: st.source_filename, statementId: st.id,
  });
  if (!run.ok) {
    return { ok: false, status: 422, code: "recon_rejected", message: run.error ?? "Could not check that invoice again.", tieOutFailures: run.tieOutFailures ?? [] };
  }
  return { ok: true, run };
}
