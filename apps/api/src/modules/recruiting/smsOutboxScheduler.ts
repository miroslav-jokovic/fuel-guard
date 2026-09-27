import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { runSmsOutboxOnce } from "./smsOutbox.js";

/**
 * The outbox drain (A-11, C2d) — its own scheduler, every five minutes.
 *
 * ⚠ Not a second pass of the six-hourly DQ scheduler, the way A10's nudge is: a text queued for 09:00
 * must go at 09:00, not at whichever six-hour tick follows, and the window it waits for is only eleven
 * hours wide. Five minutes is the lateness the recipient can see.
 *
 * ⚠ It runs wherever `startAllSchedulers` runs, which must be exactly one process fleet-wide — the api
 * service in production (`docs/WORKER-DEPLOYMENT.md`, which lists it). The drain's conditional claim
 * refuses to send a row twice even if that invariant breaks, but a second drainer would still double
 * the reads for nothing.
 */
const DRAIN_INTERVAL_MS = 5 * 60_000;

export function startSmsOutboxScheduler(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runSmsOutboxOnce(getSupabaseAdmin(env), env, new Date());
      if (r.sent + r.failed + r.cancelled > 0) {
        console.log(`[sms-outbox] ${r.sent} sent, ${r.failed} failed, ${r.cancelled} cancelled, ${r.deferred} deferred`);
      }
    } catch (e) {
      console.error("[sms-outbox] drain failed:", e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setInterval(run, DRAIN_INTERVAL_MS);
  console.log("[sms-outbox] SMS outbox drain scheduler enabled");
}
