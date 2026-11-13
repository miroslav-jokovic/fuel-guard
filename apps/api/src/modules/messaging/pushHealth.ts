import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { chatPushKeys } from "./chatPush.js";

/**
 * Are chat notifications reaching phones? Published on `GET /api/version` as `webPush` and folded into `ok`
 * (CHAT-WEB-PUSH-PLAN WP4, D-WP12) — the `realtimeHealth.ts` shape, for its reason: a delivery nobody
 * watches stops quietly. Before this, a push service refusing every push was one `[chat-push]` log line per
 * device, and nobody reads those at night.
 *
 * WHAT IT WATCHES: each live device's LATEST outcome in the last 24 hours — `last_success_at` against
 * `last_failure_at` (both written by `recordPushOutcome`). A device's latest answer is the one that says
 * what pushing to it does now; a success last night and a refusal this morning is a refusal.
 *
 *  · `off`          — no key pair on this server: push is off by deployment, the rail shows the in-tab
 *                     alerts. Healthy, and visible as itself.
 *  · `pending`      — the table does not exist yet (the minutes before 0599 applies). Healthy.
 *  · `ok`           — no device's latest answer in 24 h was a failure.
 *  · `degraded`     — some were, but not the key's kind, or fewer than the devices still delivering: one
 *                     phone that dropped off, a push service having a bad minute. Healthy, published.
 *  · `key_rejected` — more devices' latest answer was 401/403 than were delivered to. A push service says
 *                     401/403 when the VAPID signature or key does not match the subscription: the key pair
 *                     in Parameter Store was changed, or production got staging's. EVERY phone is silent,
 *                     and only a person can fix it (plan §3.6: re-set the pair, people turn it on again).
 *                     Not healthy — `platform-health.mjs` pages on it.
 *  · `unknown`      — the table could not be read. Not healthy, as everywhere on this endpoint.
 *
 * Public: a state and three platform-wide counts of devices. Nothing tenant-scoped — no org, no person.
 *
 * ⚠ PLATFORM-WIDE ON PURPOSE: this is the one service read of `web_push_subscriptions` without an org filter,
 * because the question — is the key pair being refused — is the server's, not a carrier's. It selects three
 * timestamps and the failure text; no endpoint, key or person leaves the database.
 */
export type PushHealthState = "off" | "pending" | "ok" | "degraded" | "key_rejected" | "unknown";

export interface PushHealth {
  state: PushHealthState;
  /** Devices whose latest answer in 24 h was a 401/403; null when not read. */
  rejected24h: number | null;
  /** Devices whose latest answer in 24 h was any other failure. */
  failing24h: number | null;
  /** Devices whose latest answer in 24 h was a delivery. */
  delivered24h: number | null;
}

export function pushHealthy(state: PushHealthState): boolean {
  return state !== "key_rejected" && state !== "unknown";
}

export interface PushOutcomeRow {
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure: string | null;
}

const DAY_MS = 24 * 3_600_000;
/** `recordPushOutcome` writes `"<status>: <detail>"`; 401 and 403 are the push service refusing our key. */
const KEY_REFUSAL = /^40[13]:/;

/** Pure: the published state from each live device's latest outcome. */
export function toPushHealth(rows: readonly PushOutcomeRow[], nowMs: number): PushHealth {
  let rejected = 0, failing = 0, delivered = 0;
  for (const r of rows) {
    const ok = r.last_success_at ? Date.parse(r.last_success_at) : -Infinity;
    const bad = r.last_failure_at ? Date.parse(r.last_failure_at) : -Infinity;
    const latest = Math.max(ok, bad);
    if (!Number.isFinite(latest) || nowMs - latest > DAY_MS) continue;
    if (ok >= bad) delivered += 1;
    else if (KEY_REFUSAL.test(r.last_failure ?? "")) rejected += 1;
    else failing += 1;
  }
  const counts = { rejected24h: rejected, failing24h: failing, delivered24h: delivered };
  if (rejected > 0 && rejected > delivered) return { state: "key_rejected", ...counts };
  return { state: rejected + failing > 0 ? "degraded" : "ok", ...counts };
}

const NOT_READ = { rejected24h: null, failing24h: null, delivered24h: null };
/** Postgres: relation does not exist — the window before the migration applies. */
const UNDEFINED_TABLE = "42P01";

/** `/api/version` is public and unauthenticated; the same 30-second cache as its other reads. */
const CACHE_TTL_MS = 30_000;
let cache: { at: number; value: PushHealth } | null = null;

export function resetPushHealthCache(): void {
  cache = null;
}

export async function getPushHealth(env: Env, nowMs: number = Date.now()): Promise<PushHealth> {
  if (cache && nowMs - cache.at < CACHE_TTL_MS) return cache.value;
  let value: PushHealth;
  if (!chatPushKeys(env)) {
    value = { state: "off", ...NOT_READ };
  } else {
    try {
      const since = new Date(nowMs - DAY_MS).toISOString();
      const { data, error } = await getSupabaseAdmin(env)
        .from("web_push_subscriptions")
        .select("last_success_at, last_failure_at, last_failure")
        .is("revoked_at", null)
        .or(`last_success_at.gte.${since},last_failure_at.gte.${since}`);
      if ((error as { code?: string } | null)?.code === UNDEFINED_TABLE) value = { state: "pending", ...NOT_READ };
      else if (error) value = { state: "unknown", ...NOT_READ };
      else value = toPushHealth((data ?? []) as PushOutcomeRow[], nowMs);
    } catch {
      value = { state: "unknown", ...NOT_READ };
    }
  }
  cache = { at: nowMs, value };
  return value;
}
