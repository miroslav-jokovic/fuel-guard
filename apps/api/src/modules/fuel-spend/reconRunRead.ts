/**
 * Read back saved invoice checks — the list, and one check with the lines it found (FS3, D-FSV8).
 *
 * ── WHAT IS READ IS WHAT WAS WRITTEN ────────────────────────────────────────────────────────────
 * A saved check is opened from `fuel_recon_runs` and `fuel_recon_run_rows` (0406) as they were written
 * on the day, never by re-running the matcher: our fills move after a run, so a re-match is a new
 * finding wearing the old run's date. Runs recorded before 0406 have no lines; they come back with
 * `lines: null` and the page says the lines were not kept, rather than showing an empty table that
 * reads as "nothing was found".
 *
 * ── THE SERVICE ROLE BYPASSES RLS ───────────────────────────────────────────────────────────────
 * Every query carries its own `.eq("org_id", …)`, the only tenant boundary this code has.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotReportFill, ReconRow, ReconSummary } from "@silvicom/shared";

const RUN_COLS =
  "id, source_kind, source_filename, invoice_no, statement_id, period_start, period_end, tie_out_gated, " +
  "tie_out_notes, matcher_version, summary, unmatchable_lines, created_at, superseded_by, superseded_at";

export interface ReconRunRecord {
  id: string;
  source_kind: "weekly_statement" | "monthly_export";
  source_filename: string | null;
  invoice_no: string | null;
  statement_id: string | null;
  period_start: string;
  period_end: string;
  tie_out_gated: boolean;
  tie_out_notes: string[];
  matcher_version: string;
  summary: ReconSummary;
  unmatchable_lines: number;
  created_at: string;
  superseded_by: string | null;
  superseded_at: string | null;
}

/** Most a page may ask for. The list is a hand-upload log, ~5 a month; 100 is two years on one page. */
export const RECON_RUNS_MAX_PAGE = 100;

export interface ReconRunPage {
  runs: ReconRunRecord[];
  /** Every live run this org holds, so the page can say "1–25 of 61" and page past PostgREST's cap. */
  total: number;
}

/** The live runs, newest period first. Superseded ones are history, reachable by id, not listed. */
export async function listReconRuns(
  admin: SupabaseClient,
  orgId: string,
  page: { limit: number; offset: number },
): Promise<{ ok: true; page: ReconRunPage } | { ok: false; error: { message?: string } }> {
  const limit = Math.min(Math.max(Math.trunc(page.limit) || 1, 1), RECON_RUNS_MAX_PAGE);
  const offset = Math.max(Math.trunc(page.offset) || 0, 0);
  const { data, error, count } = await admin
    .from("fuel_recon_runs")
    .select(RUN_COLS, { count: "exact" })
    .eq("org_id", orgId)
    .is("superseded_by", null)
    .order("period_start", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) return { ok: false, error };
  return { ok: true, page: { runs: (data ?? []) as unknown as ReconRunRecord[], total: count ?? 0 } };
}

export interface ReconRunDetail {
  run: ReconRunRecord;
  /** The lines as the run recorded them; `null` when this run predates 0406 or its lines failed to save. */
  lines: ReconRow[] | null;
  /** DEF and in-store lines set aside, never scored as fuel. `null` with `lines`. */
  unmatchable: PilotReportFill[] | null;
}

/** One saved check, superseded or not — a link to an old check must still open it. `null` = not ours. */
export async function readReconRun(
  admin: SupabaseClient,
  orgId: string,
  runId: string,
): Promise<{ ok: true; detail: ReconRunDetail | null } | { ok: false; error: { message?: string } }> {
  const run = await admin.from("fuel_recon_runs").select(RUN_COLS).eq("org_id", orgId).eq("id", runId).maybeSingle();
  if (run.error) return { ok: false, error: run.error };
  if (!run.data) return { ok: true, detail: null };
  const lines = await admin
    .from("fuel_recon_run_rows")
    .select("rows, unmatchable")
    .eq("org_id", orgId)
    .eq("run_id", runId)
    .maybeSingle();
  if (lines.error) return { ok: false, error: lines.error };
  const kept = lines.data as { rows: ReconRow[]; unmatchable: PilotReportFill[] } | null;
  return {
    ok: true,
    detail: {
      run: run.data as unknown as ReconRunRecord,
      lines: kept?.rows ?? null,
      unmatchable: kept?.unmatchable ?? null,
    },
  };
}
