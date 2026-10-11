/**
 * Reconciliation runs — recorded on the server, read back here.
 *
 * ── THE BROWSER SENDS BYTES AND GETS BACK A FINDING ─────────────────────────────────────────────
 * The reconciliation used to run in this tab: parse a file, match in memory, draw a table, forget it
 * the moment the tab changed. Nothing recorded what was compared, against what, with which tolerances,
 * by whom, or what it concluded — so a discrepancy found in March could not be reopened in April, and
 * the fuel-theft surface the page exists to watch left no trace at all.
 *
 * Now the decode stays here (only the browser has `pdfjs` and ExcelJS) and everything that decides
 * MEANING happens server-side: re-parse, tie-out, read our own fills with the service role, match,
 * write. `fuel_recon_runs` carries no client write policy, so this is not merely the intended path —
 * a browser cannot assert a finding at all (D-FX1).
 *
 * A rejection here is therefore not a transport failure. It means the file did not add up, and its
 * reasons are surfaced verbatim rather than flattened into "could not reconcile".
 */
import { computed, type Ref } from "vue";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import type { PilotReportFill, ReconResult, ReconRow, ReconSummary, StatementWord } from "@silvicom/shared";
import { apiFetch } from "@/lib/api";

export interface ReconRunSummaryRow {
  id: string;
  source_kind: "weekly_statement" | "monthly_export";
  source_filename: string | null;
  invoice_no: string | null;
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

export interface ReconRunResponse {
  ok: boolean;
  runId?: string;
  periodStart?: string;
  periodEnd?: string;
  invoiceNo?: string | null;
  tieOutGated?: boolean;
  tieOutNotes?: string[];
  /** The earlier check of the same invoice this one replaced in the list. */
  supersededRunId?: string;
  /** Set when the run was recorded but its lines were not; the saved check then shows totals only. */
  linesError?: string | null;
  result?: ReconResult;
}

/** Thrown when the server refused the file. `reasons` are the gate's own words. */
export class ReconRejected extends Error {
  constructor(message: string, readonly reasons: string[]) {
    super(message);
    this.name = "ReconRejected";
  }
}

export interface ReconRunInput {
  words?: StatementWord[] | null;
  grid?: unknown[][] | null;
  /** The export's PivotTable sheet — the printed total its tie-out gate checks the parse against. */
  pivotGrid?: unknown[][] | null;
  filename: string;
  statementId?: string | null;
}

export function useRunReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReconRunInput): Promise<ReconRunResponse> => {
      const res = await apiFetch<ReconRunResponse>("/api/fueling/recon-runs", { method: "POST", body: input });
      if (!res.ok || !res.data?.ok) {
        const reasons = Array.isArray(res.detail?.tieOutFailures) ? (res.detail.tieOutFailures as string[]) : [];
        throw new ReconRejected(res.error?.message ?? "Could not reconcile that report", reasons);
      }
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fuel_recon_runs"] }),
  });
}

export interface ReconRunPage {
  runs: ReconRunSummaryRow[];
  /** Every live check the org holds, so the list can page past what one answer carries. */
  total: number;
}

/**
 * The saved checks, one page at a time, newest week first. Superseded ones are history and the API
 * omits them; they stay reachable by id from the check that replaced them.
 */
export function useReconRunsQuery(page: Ref<number>, pageSize: number) {
  return useQuery({
    queryKey: ["fuel_recon_runs", "page", page, pageSize],
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ReconRunPage> => {
      const offset = (page.value - 1) * pageSize;
      const res = await apiFetch<{ ok: boolean } & ReconRunPage>(`/api/fueling/recon-runs?limit=${pageSize}&offset=${offset}`);
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load your invoice checks");
      return { runs: res.data.runs ?? [], total: res.data.total ?? 0 };
    },
  });
}

export interface ReconRunDetail {
  run: ReconRunSummaryRow;
  /** As the run recorded them. `null` = this check's lines were not kept (before 0406), never "none found". */
  lines: ReconRow[] | null;
  unmatchable: PilotReportFill[] | null;
}

/** One saved check, read back from the server as it was written — never rebuilt in the browser. */
export function useReconRunQuery(id: Ref<string>) {
  return useQuery({
    queryKey: ["fuel_recon_runs", "one", id],
    enabled: computed(() => id.value !== ""),
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ReconRunDetail | null> => {
      const res = await apiFetch<{ ok: boolean } & ReconRunDetail>(`/api/fueling/recon-runs/${encodeURIComponent(id.value)}`);
      if (res.status === 404) return null;
      if (!res.ok || !res.data) throw new Error(res.error?.message ?? "Could not load that invoice check");
      return { run: res.data.run, lines: res.data.lines, unmatchable: res.data.unmatchable };
    },
  });
}
