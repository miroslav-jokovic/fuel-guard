import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";

/**
 * Queue observability (plan A1 — "observed from day one"). Reports the live backlog so a queue that starts
 * to back up is VISIBLE (via the admin endpoint + the passive periodic log) instead of silently growing.
 * PostgREST-only (no raw pg), consistent with the rest of the stack. Scope to one org (tenant-facing
 * endpoint) or omit orgId for a fleet-wide view (the worker's periodic log).
 */

export interface QueueMetrics {
  queued: number;
  running: number;
  /** Jobs that ended in `failed` within the last 24h — a coarse error-rate signal. */
  failedRecent: number;
  /** How long the oldest still-queued job has waited (seconds) — the primary A1 backlog signal. */
  oldestQueuedAgeSec: number | null;
  oldestQueuedKind: string | null;
  byKind: Array<{ kind: string; queued: number; running: number; oldestQueuedAgeSec: number | null }>;
  /** True if the active tail exceeded the row cap — counts are floored at the cap (a deep backlog). */
  truncated: boolean;
  at: string;
}

// The active tail (queued + running) is tiny in a healthy system; cap the read so a pathological backlog
// can't fetch unboundedly. Ordered oldest-first, so the oldest-queued age stays exact even when truncated.
const ACTIVE_ROW_CAP = 2000;

export async function queueMetrics(admin: SupabaseClient, orgId?: string | null): Promise<QueueMetrics> {
  const now = Date.now();

  let activeQuery = admin
    .from("jobs")
    .select("kind, status, created_at")
    .in("status", ["queued", "running"])
    .order("created_at", { ascending: true })
    .limit(ACTIVE_ROW_CAP + 1);
  if (orgId) activeQuery = activeQuery.eq("org_id", orgId);
  const { data: active } = await activeQuery;

  const rows = (active ?? []) as Array<{ kind: string; status: string; created_at: string }>;
  const truncated = rows.length > ACTIVE_ROW_CAP;
  const tail = truncated ? rows.slice(0, ACTIVE_ROW_CAP) : rows;

  const perKind = new Map<string, { queued: number; running: number; oldestQueuedMs: number | null }>();
  let queued = 0;
  let running = 0;
  let oldestQueuedMs: number | null = null;
  let oldestQueuedKind: string | null = null;
  for (const r of tail) {
    const k = perKind.get(r.kind) ?? { queued: 0, running: 0, oldestQueuedMs: null };
    if (r.status === "queued") {
      queued++;
      k.queued++;
      const ts = new Date(r.created_at).getTime();
      if (k.oldestQueuedMs === null || ts < k.oldestQueuedMs) k.oldestQueuedMs = ts;
      if (oldestQueuedMs === null || ts < oldestQueuedMs) {
        oldestQueuedMs = ts;
        oldestQueuedKind = r.kind;
      }
    } else {
      running++;
      k.running++;
    }
    perKind.set(r.kind, k);
  }

  let failedQuery = admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("finished_at", new Date(now - 24 * 3_600_000).toISOString());
  if (orgId) failedQuery = failedQuery.eq("org_id", orgId);
  const { count: failedRecent } = await failedQuery;

  const ageSec = (ms: number | null) => (ms === null ? null : Math.max(0, Math.round((now - ms) / 1000)));
  return {
    queued,
    running,
    failedRecent: failedRecent ?? 0,
    oldestQueuedAgeSec: ageSec(oldestQueuedMs),
    oldestQueuedKind,
    byKind: [...perKind.entries()]
      .map(([kind, v]) => ({ kind, queued: v.queued, running: v.running, oldestQueuedAgeSec: ageSec(v.oldestQueuedMs) }))
      .sort((a, b) => b.queued - a.queued),
    truncated,
    at: new Date(now).toISOString(),
  };
}

/** A queued job waiting longer than this in queue mode means workers aren't keeping up (A1 tripwire). */
const BACKLOG_WARN_SEC = 300;

/**
 * Passive queue-health log (plan A1). Runs on the scheduler process in queue mode: once per interval it
 * logs the fleet-wide backlog, and warns when the oldest queued job crosses the tripwire — so a stalled or
 * under-provisioned consumer pool is visible in logs/Sentry without anyone polling the endpoint. Returns a
 * stop handle for graceful shutdown/tests.
 */
export function startQueueMetricsLogger(env: Env, intervalMs = 60_000): { stop: () => void } {
  const admin = getSupabaseAdmin(env);
  const tick = async () => {
    try {
      const m = await queueMetrics(admin, null);
      const line = `[queue-metrics] queued=${m.queued} running=${m.running} failed24h=${m.failedRecent} oldestQueued=${m.oldestQueuedAgeSec ?? "-"}s${m.oldestQueuedKind ? ` (${m.oldestQueuedKind})` : ""}${m.truncated ? " [tail truncated]" : ""}`;
      if ((m.oldestQueuedAgeSec ?? 0) > BACKLOG_WARN_SEC) {
        console.warn(`${line} — backlog over ${BACKLOG_WARN_SEC}s; consumers may be down or under-provisioned`);
      } else {
        console.log(line);
      }
    } catch (e) {
      console.error("[queue-metrics] tick failed:", e instanceof Error ? e.message : e);
    }
  };
  const handle = setInterval(() => void tick(), intervalMs);
  void tick(); // emit one immediately so a boot is observable without waiting a full interval
  return { stop: () => clearInterval(handle) };
}

/**
 * Jobs of the named kinds that ended `failed` since `sinceIso`, oldest first — for a pass that
 * turns a failed repair into a finding somebody sees (D-FIN3). A failed `efs_window_refetch` sat
 * in this table for six days in 2026-08 with nobody told; the queue reports it, the caller
 * decides who hears. Org-scoped by argument, capped so a crash loop cannot fetch unboundedly.
 */
export interface FailedJobRow {
  id: string;
  kind: string;
  error: string | null;
  finished_at: string | null;
}
export async function recentFailedJobs(
  admin: SupabaseClient,
  orgId: string,
  kinds: readonly string[],
  sinceIso: string,
): Promise<FailedJobRow[]> {
  const { data, error } = await admin
    .from("jobs")
    .select("id, kind, error, finished_at")
    .eq("org_id", orgId)
    .eq("status", "failed")
    .in("kind", [...kinds])
    .gte("finished_at", sinceIso)
    .order("finished_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as FailedJobRow[];
}
