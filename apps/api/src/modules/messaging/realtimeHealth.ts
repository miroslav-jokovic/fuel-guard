import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";

/**
 * Is Supabase Realtime delivering? Published on `GET /api/version` as `realtime` and folded into `ok`
 * — the `storageBackupHealth.ts` shape, for the same reason: a health nobody watches is a feature that
 * stopped in March. `platform-health.yml` already reads `ok` every 15 minutes and pages the alert
 * recipients on a non-ok state seen twice.
 *
 * Two facts from `platform_realtime_health` (0515):
 *   · the latest PROBE (`realtimeProbe.ts`): did a broadcast from the database reach a subscriber,
 *     and when was that last tried;
 *   · how many chat signals the database FAILED to send in the last 24 hours (the trigger's own rows).
 *
 *  · `pending`  — no probe row yet: the quarter-hour after the deploy that ships this, or an
 *                 environment whose schedulers do not run. Healthy, and visible as itself.
 *  · `ok`       — the latest probe is within FRESH_MS and arrived.
 *  · `degraded` — the latest probe arrived, but some chat signal failed to send today. Healthy for
 *                 `ok` (one failed announcement is one message that reached its reader by poll,
 *                 not an outage), published so a run of them can be seen and asked about.
 *  · `failing`  — the latest probe did not arrive: Realtime is not delivering.
 *  · `stale`    — the latest probe is older than FRESH_MS: the probe stopped running.
 *  · `unknown`  — the table could not be read. Not healthy: "I could not check" is never "all good".
 *
 * ⚠ For the ten minutes between a deploy serving this reader and `migrate.yml` applying 0515, the
 * table does not exist (42P01). That is `pending`, not `unknown`: holding the reader behind its
 * migration is the rule for a new table's first reader, and a 503 from `/ready` during the window would
 * page on a deploy doing exactly what it should.
 *
 * Public: a state, one timestamp, one latency, one platform-wide count. Nothing tenant-scoped.
 */
export type RealtimeState = "pending" | "ok" | "degraded" | "failing" | "stale" | "unknown";

export interface RealtimeHealth {
  state: RealtimeState;
  lastProbeAt: string | null;
  latencyMs: number | null;
  /** Chat signals the database could not send in the last 24 h; null when unreadable. */
  sendFailures24h: number | null;
}

/** Three probe intervals: a deploy through one tick is caught up at the next; two missed is an alarm. */
export const PROBE_FRESH_MS = 45 * 60_000;

export function realtimeHealthy(state: RealtimeState): boolean {
  return state === "pending" || state === "ok" || state === "degraded";
}

export interface ProbeRow {
  at: string;
  ok: boolean;
  latency_ms: number | string | null;
}

/** Pure: the published state from the latest probe and the day's failure count. */
export function toRealtimeHealth(probe: ProbeRow | null, sendFailures24h: number | null, nowMs: number): RealtimeHealth {
  if (!probe) return { state: "pending", lastProbeAt: null, latencyMs: null, sendFailures24h };
  const at = Date.parse(probe.at);
  const latencyMs = probe.latency_ms === null ? null : Number(probe.latency_ms);
  const base = { lastProbeAt: probe.at, latencyMs, sendFailures24h };
  if (!Number.isFinite(at) || nowMs - at >= PROBE_FRESH_MS) return { state: "stale", ...base };
  if (!probe.ok) return { state: "failing", ...base };
  return { state: (sendFailures24h ?? 0) > 0 ? "degraded" : "ok", ...base };
}

const UNKNOWN: RealtimeHealth = { state: "unknown", lastProbeAt: null, latencyMs: null, sendFailures24h: null };
/** Postgres: relation does not exist — the window before the migration applies. */
const UNDEFINED_TABLE = "42P01";

/** `/api/version` is public and unauthenticated; the same 30-second cache as the schema read. */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: RealtimeHealth } | null = null;

export function resetRealtimeHealthCache(): void {
  cache = null;
}

export async function getRealtimeHealth(env: Env, nowMs: number = Date.now()): Promise<RealtimeHealth> {
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.value;
  let value: RealtimeHealth;
  try {
    const admin = getSupabaseAdmin(env);
    const since = new Date(nowMs - 24 * 3_600_000).toISOString();
    const [probe, failures] = await Promise.all([
      admin.from("platform_realtime_health").select("at, ok, latency_ms").eq("kind", "probe")
        .order("at", { ascending: false }).limit(1),
      admin.from("platform_realtime_health").select("id", { count: "exact", head: true })
        .eq("kind", "chat_send_failed").gte("at", since),
    ]);
    const missing = (e: { code?: string } | null) => e?.code === UNDEFINED_TABLE;
    if (missing(probe.error as { code?: string } | null) || missing(failures.error as { code?: string } | null)) {
      value = { state: "pending", lastProbeAt: null, latencyMs: null, sendFailures24h: null };
    } else if (probe.error || failures.error) {
      value = UNKNOWN;
    } else {
      const row = ((probe.data ?? []) as ProbeRow[])[0] ?? null;
      value = toRealtimeHealth(row, failures.count ?? null, nowMs);
    }
  } catch {
    value = UNKNOWN;
  }
  cache = { at: nowMs, value };
  return value;
}
