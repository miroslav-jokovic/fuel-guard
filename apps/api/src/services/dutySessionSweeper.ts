import type { Env } from "../env.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { closeStaleDutySessions } from "./dutySessions.js";
import { notify, loginForDriver } from "../modules/messaging/index.js";

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
 * Phase 6 (D53): each auto-close now also tells the driver — an ended shift they didn't end is
 * exactly the kind of silent state change that erodes trust in the app. Dedupe-keyed on the session
 * id, so a re-notify sweep after a crash can never buzz twice for the same close.
 *
 * Mirrors the EFS-ingest scheduler shape: interval + in-flight guard, disabled by env, failures
 * logged and counted, never crashing the process.
 */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** Tell each driver whose shift was just auto-closed. Best-effort — the close itself already stands. */
async function notifyAutoClosed(admin: SupabaseClient, sinceIso: string): Promise<void> {
  const { data } = await admin
    .from("driver_duty_sessions")
    .select("id, org_id, driver_id")
    .eq("ended_reason", "auto_timeout")
    .gte("ended_at", sinceIso);
  for (const s of (data ?? []) as { id: string; org_id: string; driver_id: string }[]) {
    const userId = await loginForDriver(admin, s.org_id, s.driver_id);
    if (!userId) continue;
    await notify(admin, {
      orgId: s.org_id,
      userId,
      category: "duty_auto_closed",
      title: "Your shift was closed automatically",
      body: "It ran past your fleet's time limit, so the truck was released. Check in again when you're back on duty.",
      severity: "warning",
      entityType: "driver_duty_sessions",
      entityId: s.id,
      dedupeKey: `duty_auto_closed:${s.id}`,
    });
  }
}

export function startDutySessionSweeper(env: Env): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  let inFlight = false;
  const run = async (): Promise<void> => {
    if (inFlight) return; // a slow sweep must never overlap itself
    inFlight = true;
    try {
      const admin = getSupabaseAdmin(env);
      // Look back a little over one interval so a close from a crashed run is still announced
      // (the dedupe key makes the overlap harmless).
      const sinceIso = new Date(Date.now() - 2 * DEFAULT_INTERVAL_MS).toISOString();
      const closed = await closeStaleDutySessions(admin);
      if (closed > 0) {
        console.log(`[duty] auto-closed ${closed} stale shift(s)`);
        await notifyAutoClosed(admin, sinceIso);
      }
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
