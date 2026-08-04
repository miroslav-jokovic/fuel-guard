import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Anomaly-flag reconcile — keeps `fuel_transactions.has_anomaly` / `max_severity` consistent with the
 * anomalies table (the source of truth the Alerts page reads).
 *
 * WHY: the flag is written at scoring time, but detection logic has changed repeatedly since fills were
 * first scored, and rebuilds SUPERSEDE anomaly rows without re-scoring every historical fill (the
 * nightly rules-only rebuild is bounded to recent days on purpose). That left old fills marked red in
 * the Fuel Log whose anomalies no longer exist on the Alerts page — a flagged row that dead-ends when
 * clicked. This sweep repairs both directions in bounded batches: flags with no live (non-superseded)
 * anomaly are cleared, and fills that DO have live anomalies but lost their flag are re-marked with the
 * correct max severity.
 */

const PAGE = 1000;
const UPDATE_BATCH = 500;

export interface FlagReconcileResult {
  cleared: number; // flagged fills with no live anomaly → unflagged
  restored: number; // unflagged fills with live anomalies → re-flagged
}

const SEV_RANK: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
const maxSev = (a: string | null, b: string): string =>
  a == null || (SEV_RANK[b] ?? 0) > (SEV_RANK[a] ?? 0) ? b : a;

async function pageAll<T>(
  build: (a: number, b: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

export async function reconcileAnomalyFlags(
  admin: SupabaseClient,
  orgId: string,
): Promise<FlagReconcileResult> {
  // Live (non-superseded) anomalies → max severity per transaction.
  const anomalies = await pageAll<{ transaction_id: string | null; severity: string }>((a, b) =>
    admin
      .from("anomalies")
      .select("transaction_id, severity")
      .eq("org_id", orgId)
      .neq("status", "superseded")
      .order("id", { ascending: true })
      .range(a, b),
  );
  const liveSevByTxn = new Map<string, string>();
  for (const a of anomalies) {
    if (!a.transaction_id) continue;
    liveSevByTxn.set(a.transaction_id, maxSev(liveSevByTxn.get(a.transaction_id) ?? null, a.severity));
  }

  // Flagged fills → clear the ones with no live anomaly.
  const flagged = await pageAll<{ id: string }>((a, b) =>
    admin
      .from("fuel_transactions")
      .select("id")
      .eq("org_id", orgId)
      .eq("has_anomaly", true)
      .order("id", { ascending: true })
      .range(a, b),
  );
  const toClear = flagged.map((t) => t.id).filter((id) => !liveSevByTxn.has(id));
  for (let i = 0; i < toClear.length; i += UPDATE_BATCH) {
    const { error } = await admin
      .from("fuel_transactions")
      .update({ has_anomaly: false, max_severity: null })
      .eq("org_id", orgId)
      .in("id", toClear.slice(i, i + UPDATE_BATCH));
    if (error) throw new Error(error.message);
  }

  // Fills with live anomalies but no flag → restore, grouped by severity so each batch is one UPDATE.
  const flaggedIds = new Set(flagged.map((t) => t.id));
  const toRestore = [...liveSevByTxn.entries()].filter(([id]) => !flaggedIds.has(id));
  const bySeverity = new Map<string, string[]>();
  for (const [id, sev] of toRestore) {
    const list = bySeverity.get(sev) ?? [];
    list.push(id);
    bySeverity.set(sev, list);
  }
  let restored = 0;
  for (const [sev, ids] of bySeverity) {
    for (let i = 0; i < ids.length; i += UPDATE_BATCH) {
      const { error } = await admin
        .from("fuel_transactions")
        .update({ has_anomaly: true, max_severity: sev })
        .eq("org_id", orgId)
        .in("id", ids.slice(i, i + UPDATE_BATCH));
      if (error) throw new Error(error.message);
      restored += Math.min(UPDATE_BATCH, ids.length - i);
    }
  }

  if (toClear.length || restored) {
    console.log(
      `[flag-reconcile] org ${orgId}: cleared ${toClear.length} stale flags, restored ${restored}`,
    );
  }
  return { cleared: toClear.length, restored };
}
