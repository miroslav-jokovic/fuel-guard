import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { dispatchJob } from "../../queue/dispatch.js";
import { lastDoneJob } from "../org/index.js";
import { orgsWithFleetpal } from "./credentials.js";

/**
 * The FleetPal poller (FLEETPAL-INTEGRATION-PLAN.md F8).
 *
 * ── ⚠ THIS MUST RUN IN EXACTLY ONE PROCESS FLEET-WIDE ─────────────────────────────────────────
 * `docs/WORKER-DEPLOYMENT.md` is the register and now names this scheduler. Production runs two
 * services from one `railway.json`; `RUN_SCHEDULERS_IN_PROCESS` defaults to **true**, so a service
 * that is never given the variable runs the whole scheduler set — which is how `@fleetguard/web`
 * came to run every poller alongside the api until 2026-09-05. Two processes polling FleetPal would
 * double the request rate against a vendor that publishes no limit and sends no limiter headers
 * (F4), and the second copy would be invisible: the jobs ledger refuses the overlapping run, so the
 * only symptom is a request count nobody is watching.
 *
 * ── ONE CADENCE, NOT TWO ──────────────────────────────────────────────────────────────────────
 * The plan proposed the repair record hourly and the catalogues daily. Measuring made that
 * distinction empty: every resource in the sweep is watermarked or bounded, so an hourly pass over
 * the reference lists asks `updated_after=<an hour ago>` and gets an empty page back — the cost of
 * "too often" is one HTTP round trip per resource, and the cost of "not often enough" is a report
 * built on yesterday's vendor list. So: one hourly sweep, and `FLEETPAL_SYNC_HOURS` to change it.
 * If the parts catalogue (F12) ever makes a pass expensive, this is the comment to revisit.
 *
 * Shape copied from `efsCardSyncScheduler`: early return when unconfigured, an in-flight guard so a
 * slow pass cannot overlap the next tick, per-org dispatch through the jobs ledger (which refuses an
 * overlapping run for the same org), and one org's failure never stopping the others.
 */
export function isFleetpalSyncDue(
  lastFinishedAt: string | null | undefined,
  nowMs: number,
  intervalMs: number,
): boolean {
  if (!lastFinishedAt) return true;
  const finishedMs = Date.parse(lastFinishedAt);
  return !Number.isFinite(finishedMs) || nowMs - finishedMs >= intervalMs;
}

export function startFleetpalScheduler(env: Env): void {
  if (!env.FLEETPAL_SYNC_ENABLED) return; // the collector's kill switch, off by default
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  const intervalMs = Math.max(1, env.FLEETPAL_SYNC_HOURS) * 60 * 60 * 1000;
  let running = false;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const admin = getSupabaseAdmin(env);
      // Orgs with the integration ON and a key STORED. Neither half alone: an enabled row with no
      // key is a 401 per tick for ever, and a key with the switch off is the kill switch working.
      for (const orgId of await orgsWithFleetpal(admin)) {
        try {
          const lastDone = await lastDoneJob(admin, orgId, "fleetpal_sync");
          if (!isFleetpalSyncDue(lastDone?.finished_at, Date.now(), intervalMs)) continue;
          // A conflict means a sweep for this org is already active — the ledger doing its job.
          await dispatchJob(admin, env, "fleetpal_sync", { orgId, payload: { orgId } });
        } catch (error) {
          console.error(
            `[fleetpal] org ${orgId}: could not queue a sweep — ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      console.error(
        `[fleetpal] sweep dispatch failed — ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
    }
  };

  // A few minutes after boot, so a deploy does not have every scheduler dial its vendor at once —
  // and behind the EFS feeds, which are the ones measured in minutes rather than hours.
  setTimeout(() => void run(), 6 * 60_000);
  setInterval(() => void run(), intervalMs);
}
