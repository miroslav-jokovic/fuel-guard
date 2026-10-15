import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../queue/dispatch.js";
import { lastDoneJob } from "../org/index.js";
import { orgsWithMedstop } from "./credentials.js";
import { alertMedstopConnection } from "./connectionAlert.js";

/**
 * The Med-Stop poller (MEDSTOP-PLAN.md §6, MS1).
 *
 * ⚠ ONE PROCESS FLEET-WIDE, AND IT MUST BE THE api SERVICE. Two reasons stack here: the
 * one-scheduler rule every poller has (`docs/WORKER-DEPLOYMENT.md`), and Med-Stop's key is bound to
 * the api service's static egress addresses (D-MS3) — a copy running anywhere else is refused at
 * Med-Stop's firewall on every tick.
 *
 * Hourly by default: a random selection is acted on the day it is drawn, and a roster change in
 * McLeod should reach the "not in the pool" list the same morning. A sweep is ~25 requests against
 * a 100-a-minute limit. Shape copied from `startFleetpalScheduler`.
 */
/**
 * A constant, not a variable: nothing measured argues for another cadence, and `env.ts` is at its
 * 500-line budget — a knob nobody turns is not worth a line there.
 */
export const MEDSTOP_SYNC_HOURS = 1;

export function startMedstopScheduler(env: Env): void {
  if (!env.MEDSTOP_SYNC_ENABLED) return;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;

  const intervalMs = MEDSTOP_SYNC_HOURS * 60 * 60 * 1000;
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      for (const orgId of await orgsWithMedstop(admin)) {
        // Every tick, due or not (§7A.20): a key nearing expiry, a failed sweep, and a sweep that never
        // runs are all judged here. It never throws into the loop.
        await alertMedstopConnection(admin, orgId);
        try {
          const lastDone = await lastDoneJob(admin, orgId, "medstop_sync");
          const finished = lastDone?.finished_at ? Date.parse(lastDone.finished_at) : NaN;
          if (Number.isFinite(finished) && Date.now() - finished < intervalMs) continue;
          await dispatchJob(admin, env, "medstop_sync", { orgId, payload: { orgId } });
        } catch (error) {
          console.error(`[medstop] org ${orgId}: could not queue a sweep — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.error(`[medstop] sweep dispatch failed — ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  setTimeout(() => void run(), 7 * 60_000);
  setInterval(() => void run(), intervalMs);
}
