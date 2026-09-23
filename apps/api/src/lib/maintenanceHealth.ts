import type { Env } from "../env.js";
import { getSupabaseAdmin } from "./supabaseAdmin.js";

/**
 * The database's own scheduled maintenance, as `GET /api/version` reports it (DATA-LIFECYCLE-PLAN L6,
 * D-LIFE10). Reads `public.lifecycle_maintenance_health()` (migration 0360).
 *
 * ── WHY IT IS ON THE VERSION ENDPOINT ───────────────────────────────────────────────────────────
 * `pg_cron` runs `partman.run_maintenance_proc()` hourly inside Postgres, where no gate in this repo,
 * no Railway variable and no job ledger can see it — the same class of blind spot as
 * `RUN_SCHEDULERS_IN_PROCESS`. Once L7 partitions a table, a maintenance job that has quietly stopped
 * lets inserts run off the end of the last pre-made partition: an outage, not a slow leak.
 * `/api/version` is the one surface already built to be watched ("a monitor can watch one boolean"),
 * so the job's state is published there and folded into `ok`.
 *
 * ⚠ It is a PULL surface. Nothing here pushes an alert — the repo has no platform alert channel, and
 * that is Q9 in the plan, a blocker for L7. This makes the state readable; it does not make it heard.
 *
 * `pending` counts as healthy: it is the hour between the migration applying and the first run.
 * `cron.job` carries no creation time, so "scheduled, never fired once" also reads `pending`; that one
 * case was checked by hand when 0360 applied (§8), and every failure after a first success reads
 * `stale` or `failing`. `unknown` — the function could not be called — is NOT healthy, for the reason
 * `schemaVersion.ts` gives: "I could not check" must never read as "all good".
 */
export type MaintenanceState = "ok" | "pending" | "stale" | "failing" | "inactive" | "missing" | "unknown";

export interface MaintenanceHealth {
  state: MaintenanceState;
  lastSucceededAt: string | null;
  /** Tables under pg_partman. `null` when partman is absent — never a vacuous 0. */
  partitionedTables: number | null;
}

const KNOWN = new Set<MaintenanceState>(["ok", "pending", "stale", "failing", "inactive", "missing"]);

export function maintenanceHealthy(state: MaintenanceState): boolean {
  return state === "ok" || state === "pending";
}

/** Map the function's jsonb onto the published shape; anything unrecognised is `unknown`. */
export function toMaintenanceHealth(raw: unknown): MaintenanceHealth {
  const r = (raw ?? {}) as { state?: unknown; last_succeeded_at?: unknown; partitioned_tables?: unknown };
  const state = typeof r.state === "string" && KNOWN.has(r.state as MaintenanceState) ? (r.state as MaintenanceState) : "unknown";
  return {
    state,
    lastSucceededAt: typeof r.last_succeeded_at === "string" ? r.last_succeeded_at : null,
    // jsonb numbers arrive as numbers, but PostgREST has handed this repo numerics as strings before.
    partitionedTables: r.partitioned_tables == null ? null : Number(r.partitioned_tables),
  };
}

/** `/api/version` is public and unauthenticated; the same 30-second cache as the schema read. */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: MaintenanceHealth } | null = null;

export function resetMaintenanceHealthCache(): void {
  cache = null;
}

export async function getMaintenanceHealth(env: Env, now = Date.now()): Promise<MaintenanceHealth> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;
  let value: MaintenanceHealth;
  try {
    const { data, error } = await getSupabaseAdmin(env).rpc("lifecycle_maintenance_health");
    value = error ? toMaintenanceHealth(null) : toMaintenanceHealth(data);
  } catch {
    value = toMaintenanceHealth(null); // Supabase unconfigured (local/test) — unknown, never thrown
  }
  cache = { at: now, value };
  return value;
}
