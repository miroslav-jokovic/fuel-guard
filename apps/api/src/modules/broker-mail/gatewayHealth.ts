import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";

/**
 * Is the broker-mail gateway running, and which commit? Published on `GET /api/version` as
 * `mailGateway` (BROKER-MAIL-READER-PLAN §6 Verify), so `deploy-verify`, `verify:live` and
 * `platform-health` can answer "is the gateway alive" without any AWS access — the gateway's
 * heartbeat is a database row it writes every minute (`mail_gateway_cycles`, 0643).
 *
 *  · `off`      — no config row, or switched off by the owner. Healthy: the gateway is not meant to run.
 *  · `ok`       — switched on, and a cycle started within FRESH_MS.
 *  · `stale`    — switched on, and no cycle within FRESH_MS: the schedule, the function or its
 *                 database login has stopped. Not healthy.
 *  · `stopped`  — switched off BY THE CANARY (D-BMR14): the mailbox that must be refused opened, so
 *                 the scope is wrong. Not healthy, and it stays so until a person looks.
 *  · `unknown`  — the tables could not be read. Not healthy: "I could not check" is never "all good".
 *
 * ⚠ A database without 0643 (42P01) reads as `off`, not `unknown` — the rule for a new table's first
 * reader, and true: there is nothing to run yet.
 *
 * Public: a state, a commit, one timestamp. No org, no mailbox, no count.
 */
export type GatewayState = "off" | "ok" | "stale" | "stopped" | "unknown";

export interface GatewayHealth {
  state: GatewayState;
  commit: string | null;
  lastCycleAt: string | null;
}

/** Five missed minutes: a cold start or one failed run is not an alarm; five in a row is. */
export const GATEWAY_FRESH_MS = 5 * 60_000;

export function gatewayHealthy(state: GatewayState): boolean {
  return state === "off" || state === "ok";
}

export interface ConfigRow { org_id: string; enabled: boolean; canary_result: string | null }
export interface CycleRow { started_at: string; commit: string | null }

/** Pure: the published state from the config row and the latest cycle. */
export function toGatewayHealth(config: ConfigRow | null, cycle: CycleRow | null, nowMs: number): GatewayHealth {
  const base = { commit: cycle?.commit ?? null, lastCycleAt: cycle?.started_at ?? null };
  if (!config) return { state: "off", ...base };
  if (!config.enabled) return { state: config.canary_result === "opened" ? "stopped" : "off", ...base };
  const at = cycle ? Date.parse(cycle.started_at) : NaN;
  return { state: Number.isFinite(at) && nowMs - at < GATEWAY_FRESH_MS ? "ok" : "stale", ...base };
}

const UNKNOWN: GatewayHealth = { state: "unknown", commit: null, lastCycleAt: null };
const UNDEFINED_TABLE = "42P01";
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: GatewayHealth } | null = null;

export function resetGatewayHealthCache(): void {
  cache = null;
}

export async function getGatewayHealth(env: Env, nowMs: number = Date.now()): Promise<GatewayHealth> {
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.value;
  let value: GatewayHealth;
  try {
    const admin = getSupabaseAdmin(env);
    // One gateway per database (D-BMR12): the config row names the org, and the cycle read is
    // filtered by it — the service role bypasses RLS, so the filter is the boundary.
    const cfg = await admin.from("mail_gateway_config").select("org_id, enabled, canary_result").limit(1);
    if ((cfg.error as { code?: string } | null)?.code === UNDEFINED_TABLE) {
      value = { state: "off", commit: null, lastCycleAt: null };
    } else if (cfg.error) {
      value = UNKNOWN;
    } else {
      const config = ((cfg.data ?? []) as ConfigRow[])[0] ?? null;
      let cycle: CycleRow | null = null;
      let failed = false;
      if (config) {
        const c = await admin.from("mail_gateway_cycles").select("started_at, commit").eq("org_id", config.org_id)
          .order("started_at", { ascending: false }).limit(1);
        failed = Boolean(c.error);
        cycle = ((c.data ?? []) as CycleRow[])[0] ?? null;
      }
      value = failed ? UNKNOWN : toGatewayHealth(config, cycle, nowMs);
    }
  } catch {
    value = UNKNOWN;
  }
  cache = { at: nowMs, value };
  return value;
}
