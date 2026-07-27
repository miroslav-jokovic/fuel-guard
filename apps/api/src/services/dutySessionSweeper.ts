import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { closeStaleDutySessions } from "./dutySessions.js";

/**
 * Close abandoned driver shifts (Driver App Phase 3A, decision D44.5).
 *
 * This is REQUIRED by the duty model, not housekeeping. Migration 0086 makes a truck exclusive to
 * whoever is currently seated in it (a partial unique index over open equipment segments), which is
 * what keeps fuel/idle attribution honest — but it also means the first driver who forgets to sign
 * off would lock that unit out of the fleet indefinitely. The sweeper closes any shift open past the
 * org's `duty_session_timeout_hours` (default 16 ≈ the HOS on-duty maximum plus margin) with
 * `ended_reason = 'auto_timeout'`, so an auto-close stays distinguishable from a real sign-off and
 * never quietly pollutes attribution analysis.
 *
 * Mirrors the EFS-ingest scheduler shape: interval + in-flight guard, disabled by env, failures
 * logged and counted, never crashing the process.
 */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

export function startDutySessionSweeper(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return; // a slow sweep must never overlap itself
    inFlight = true;
    try {
      const closed = await closeStaleDutySessions(getSupabaseAdmin(env));
      if (closed > 0) console.log(`[duty] auto-closed ${closed} stale shift(s)`);
    } catch (e) {
      console.error("[duty] sweep failed:", e instanceof Error ? e.message : e);
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void run(), DEFAULT_INTERVAL_MS);
  timer.unref?.();
  void run();
}
