import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { deliverPending } from "./notify.js";

/**
 * Expo Push delivery loop (hardening plan Phase 6 — the scheduler `deliverPending` was written for
 * but never had). Mirrors the duty-sweeper shape: interval + in-flight guard, disabled without DB
 * creds, failures logged and never crashing the process. One minute is the latency budget that
 * matters here — "dispatch released a load" should reach a pocket in under a minute, and
 * `deliverPending` stamps `pushed_at` per batch so overlapping runs only risk a duplicate push,
 * never a lost one (the in-flight guard prevents even that in-process).
 */
const INTERVAL_MS = 60 * 1000;

export function startNotificationPushScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const result = await deliverPending(getSupabaseAdmin(env));
      if (result.sent > 0 || result.failed > 0 || result.revoked > 0) {
        console.log(
          `[push] sent ${result.sent}, failed ${result.failed}, revoked ${result.revoked} dead token(s)`,
        );
      }
    } catch (e) {
      console.error("[push] delivery failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void run(), INTERVAL_MS);
  timer.unref?.();
  void run();
}
