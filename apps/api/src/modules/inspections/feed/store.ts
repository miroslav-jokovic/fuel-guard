/**
 * The FMCSA feed's writes and its one read (0457). The only file that touches `fmcsa_fetch_runs` /
 * `fmcsa_raw_rows`: `lint:table-writers` pins it as the runs table's one writer, and the raw rows are
 * written only inside `fmcsa_snapshot_record`, an RPC body that gate does not scan.
 *
 * A successful snapshot goes through `fmcsa_snapshot_record`, which writes the run and every changed
 * record version in one statement (0457's header says why). A failed run carries no rows, so it is a
 * plain insert here. Both are org-scoped by their `p_org` / `org_id`, and the read filters `org_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FmcsaDataset } from "@silvicom/shared";

export interface SnapshotRun {
  startedAt: Date;
  complete: boolean;
  sourceRowsUpdatedAt: Date | null;
  requestCount: number;
  durationMs: number;
}

export interface SnapshotCounts {
  runId: string;
  rowsSeen: number;
  rowsNew: number;
  rowsChanged: number;
  rowsReappeared: number;
  rowsVanished: number;
}

/** 0457's refusal of an empty complete snapshot over a dataset that has present rows. */
export const EMPTY_SNAPSHOT_REFUSED = "FM001";

export async function recordSnapshot(
  admin: SupabaseClient,
  orgId: string,
  dataset: FmcsaDataset,
  dotNumber: string,
  rows: { k: string; p: Record<string, unknown> }[],
  run: SnapshotRun,
): Promise<SnapshotCounts> {
  const { data, error } = await admin.rpc("fmcsa_snapshot_record", {
    p_org: orgId,
    p_dataset: dataset,
    p_dot_number: dotNumber,
    p_rows: rows,
    p_run: {
      started_at: run.startedAt.toISOString(),
      complete: run.complete,
      source_rows_updated_at: run.sourceRowsUpdatedAt?.toISOString() ?? null,
      request_count: run.requestCount,
      duration_ms: run.durationMs,
    },
  });
  if (error) {
    const e = new Error(`fmcsa_snapshot_record ${dataset}: ${error.message}`) as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!r?.run_id) throw new Error(`fmcsa_snapshot_record ${dataset}: no run row returned`);
  return {
    runId: String(r.run_id),
    rowsSeen: Number(r.rows_seen),
    rowsNew: Number(r.rows_new),
    rowsChanged: Number(r.rows_changed),
    rowsReappeared: Number(r.rows_reappeared),
    rowsVanished: Number(r.rows_vanished),
  };
}

export async function recordFailedRun(
  admin: SupabaseClient,
  orgId: string,
  dataset: FmcsaDataset,
  dotNumber: string,
  run: Omit<SnapshotRun, "complete">,
  message: string,
): Promise<void> {
  const { error } = await admin.from("fmcsa_fetch_runs").insert({
    org_id: orgId,
    dataset,
    dot_number: dotNumber,
    started_at: run.startedAt.toISOString(),
    outcome: "failed",
    complete: false,
    source_rows_updated_at: run.sourceRowsUpdatedAt?.toISOString() ?? null,
    request_count: run.requestCount,
    duration_ms: run.durationMs,
    error: message.slice(0, 2000),
  });
  if (error) throw new Error(`fmcsa_fetch_runs failed-run insert ${dataset}: ${error.message}`);
}

/** When the org's last successful run of a dataset finished, or null when there has been none. */
export async function lastSucceededAt(
  admin: SupabaseClient,
  orgId: string,
  dataset: FmcsaDataset,
): Promise<string | null> {
  const { data, error } = await admin
    .from("fmcsa_fetch_runs")
    .select("finished_at")
    .eq("org_id", orgId)
    .eq("dataset", dataset)
    .eq("outcome", "succeeded")
    .order("finished_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`fmcsa_fetch_runs read: ${error.message}`);
  return (data?.[0] as { finished_at?: string } | undefined)?.finished_at ?? null;
}
