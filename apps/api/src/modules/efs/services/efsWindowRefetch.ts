import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { ingestReport, type IngestDeps, type IngestResult } from "./efsIngest.js";
import { getEfsSoapCredentials } from "./efsSoapCredentials.js";
import { registerEfsProcessingRun } from "./efsProcessing.js";
import { fetchPostedTransactions } from "../lib/efsSoap.js";

/**
 * Targeted re-fetch of HISTORICAL posted-transaction windows the original backfill dropped.
 *
 * Why this exists: recon F11 (2026-08-28) measured `fuel_transactions` against McLeod's own fuel
 * account (40050000) and found two contiguous holes — 2026-04-18..05-04 and 05-06..05-18, roughly
 * $980k of fuel a 150-truck fleet demonstrably burned — plus January, which predates the feed's
 * 180-day first-poll horizon entirely. The live feed can never revisit them: its cursor only moves
 * forward. This path fetches an EXPLICIT range instead.
 *
 * What it deliberately does NOT do:
 *  · touch the live feed's cursor or its success/failure columns — a historical repair failing must
 *    not make the healthy live feed look broken (and vice versa); this run's outcome lives on the
 *    job that dispatched it;
 *  · score inline — same doctrine as the poller: raw/derived rows commit, a durable processing run
 *    owns scoring, so months-old transactions do not fire months-late alerts on the fast path.
 *
 * Idempotency is the ingest path's own: file-level (response SHA-256 as imports.file_hash) and
 * row-level (external_ref dedup), so overlapping an already-complete day double-counts nothing.
 *
 * A window that returns ZERO rows is a MEASUREMENT, not a failure: for the January window it is
 * the answer to "does EFS still serve data past our 180-day config floor?" — the vendor guide
 * documents a 7-day-per-request cap but no retention limit, so nobody knows until this asks.
 */

export interface RefetchWindowResult extends Record<string, unknown> {
  window: { start: string; end: string };
  status: "ingested" | "empty" | "failed";
  pagesFetched: number;
  rowsFetched: number;
  newFuel: number;
  error?: string;
  processingId?: string;
}

const noScoring: IngestDeps = {
  scoreImport: async () => undefined,
  scoreDeclined: async () => undefined,
};

export async function runEfsWindowRefetch(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  windows: Array<{ start: string; end: string }>,
): Promise<{ windows: RefetchWindowResult[] }> {
  if (!env.EFS_SOAP_ENABLED) {
    return { windows: windows.map((w) => ({ window: w, status: "failed" as const, pagesFetched: 0, rowsFetched: 0, newFuel: 0, error: "EFS_SOAP_ENABLED is off" })) };
  }
  const creds = await getEfsSoapCredentials(admin, env, orgId);
  if (!creds || !creds.enabled) {
    return { windows: windows.map((w) => ({ window: w, status: "failed" as const, pagesFetched: 0, rowsFetched: 0, newFuel: 0, error: "EFS SOAP credentials missing or disabled" })) };
  }

  const results: RefetchWindowResult[] = [];
  // Sequential on purpose — the per-kind in-flight cap makes this job the only EFS refetch in the
  // fleet, and these calls share the login circuit breaker with card control (WQ1c).
  for (const window of windows) {
    let pagesFetched = 0;
    let rowsFetched = 0;
    let newFuel = 0;
    let processingId: string | undefined;
    let error: string | undefined;
    let cursorInWindow: string | null = null;
    try {
      // The soap layer's own budgets (max pages/rows/ms per call) can stop a large range short;
      // `nextCursor` marks the last COMPLETED page, so resuming from it re-fetches nothing and
      // skips nothing. Loop until the range is exhausted rather than trusting one call — stopping
      // mid-hole is how the original backfill made this necessary.
      for (;;) {
        const remaining = { start: cursorInWindow ?? window.start, end: window.end };
        const result = await fetchPostedTransactions(env, creds, null, {
          priority: "backfill",
          windowOverride: remaining,
        });
        pagesFetched += result.pagesFetched;
        rowsFetched += result.rows.length;
        if (result.rows.length > 0) {
          const headers = Array.from(new Set(result.rows.flatMap((r) => Object.keys(r))));
          const ingest: IngestResult = await ingestReport(admin, env, {
            orgId,
            requestedBy: null,
            source: "efs_feed",
            filename: `efs-soap-refetch-${remaining.start.slice(0, 10)}-${remaining.end.slice(0, 10)}.xml`,
            fileHash: result.responseHash,
            headers,
            rows: result.rows,
            channel: "auto",
          }, noScoring);
          if (ingest.kind === "unknown") {
            throw new Error("EFS SOAP response did not match the expected transaction field signature");
          }
          newFuel += ingest.newFuel ?? 0;
          if (ingest.importId && (ingest.alreadyImported || (ingest.newFuel ?? 0) > 0)) {
            processingId = await registerEfsProcessingRun(admin, { orgId, importId: ingest.importId, feed: "posted" });
          }
        }
        if (!result.moreAvailable) break;
        cursorInWindow = result.nextCursor;
        if (!cursorInWindow || cursorInWindow >= window.end) break;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    results.push({
      window,
      status: error ? "failed" : rowsFetched > 0 ? "ingested" : "empty",
      pagesFetched,
      rowsFetched,
      newFuel,
      ...(error ? { error } : {}),
      ...(processingId ? { processingId } : {}),
    });
    console.log(
      `[efs-refetch] org=${orgId} ${window.start}..${window.end} pages=${pagesFetched} rows=${rowsFetched} newFuel=${newFuel}` +
        (error ? ` FAILED: ${error}` : rowsFetched === 0 ? " — EFS returned nothing for this range" : ""),
    );
  }
  return { windows: results };
}
