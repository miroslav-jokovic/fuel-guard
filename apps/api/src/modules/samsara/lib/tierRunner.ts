/**
 * How a Samsara tier RUNS — which orgs it visits, how it claims its slot, and the loop it sits in.
 *
 * ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────────────────────────
 * It was three private functions at the top of `samsaraScheduler.ts` while that file was one screen
 * of tiers. It is now nine, and LM4's positions tier pushed the file past the 500-line budget
 * (`lint:filesize`). The gate's instruction on the last occasion was "split into orchestrator + stage
 * helpers", so this is the split it asked for rather than a waiver: `samsaraScheduler.ts` keeps the
 * TIERS — what each one collects and how often — and this keeps the MACHINERY they all share.
 *
 * Nothing here changed in the move. The pieces are exported for the scheduler alone; a tier that
 * wanted to run outside it would be a scheduler in a second place, which `docs/WORKER-DEPLOYMENT.md`
 * exists to prevent.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../../env.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { NoSamsaraTokenError } from "../samsaraVehicleSync.js";
import { startJob, finishJob, startJobHeartbeat, JobConflictError, type JobKind } from "../../org/index.js";
import { enqueueJob } from "../../../queue/enqueue.js";

/** Orgs to auto-sync: those with a per-org token, plus — when the single-tenant env token is set —
 *  the OLDEST org only (2026-08 incident: the fallback used to include EVERY org row, so a stray org
 *  created by dev seed data started syncing the entire real fleet in parallel — duplicate vehicles,
 *  doubled DB load. An env token is single-tenant by definition; it belongs to exactly one org, and
 *  the oldest row is the real tenant by construction — strays are always created later). */
export async function orgsToSync(admin: SupabaseClient, env: Env): Promise<string[]> {
  const set = new Set<string>();
  const { data: creds } = await admin
    .from("integration_credentials")
    .select("org_id, samsara_api_token, enabled");
  for (const c of creds ?? []) {
    if (c.enabled !== false && c.samsara_api_token) set.add(c.org_id as string);
  }
  if (env.SAMSARA_API_TOKEN) {
    const { data: oldest } = await admin
      .from("organizations")
      .select("id")
      .order("created_at", { ascending: true })
      .limit(1);
    for (const o of oldest ?? []) set.add(o.id as string);
  }
  return [...set];
}

/**
 * Run one org's tier through the jobs ledger, honoring the execution mode (plan WQ1c):
 *  - **queue** — ENQUEUE the kind for the worker pool and return. The worker runs the handler under the
 *    bounded Samsara lane (Q7), so vendor RPS holds globally instead of N-per-scheduler-process. The
 *    handler reconstructs the work from the kind (empty payload); `work` is unused in this mode.
 *  - **inprocess** (default today) — claim the (org, kind) slot and run `work` inline, recording
 *    done/failed with stats, exactly as before this migration.
 * A conflict (a manual run or a still-running prior tick owns the slot) just means "already running" →
 * skip quietly. NoSamsaraToken records as done+skipped, not a failure.
 */
export async function runOrgTier(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  kind: JobKind,
  work: () => Promise<Record<string, unknown>>,
): Promise<void> {
  if (env.JOB_EXECUTION_MODE === "queue") {
    try {
      await enqueueJob(admin, kind, { orgId }); // scheduler runs carry no actor + an empty payload
    } catch (e) {
      if (e instanceof JobConflictError) return; // already queued/running for this (org, kind)
      console.error(
        `[samsara-sched] ${kind} enqueue failed for org ${orgId}:`,
        e instanceof Error ? e.message : e,
      );
    }
    return;
  }
  let jobId: string;
  try {
    jobId = await startJob(admin, orgId, kind); // scheduler runs have no requested_by
  } catch (e) {
    if (e instanceof JobConflictError) return; // a run of this kind is already active for the org
    console.error(
      `[samsara-sched] ${kind} start failed for org ${orgId}:`,
      e instanceof Error ? e.message : e,
    );
    return;
  }
  const stopHeartbeat = startJobHeartbeat(admin, jobId); // P0-4: big-fleet stat syncs can outlive one lease
  try {
    const stats = await work();
    await finishJob(admin, jobId, { status: "done", stats });
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) {
      await finishJob(admin, jobId, { status: "done", stats: { skipped: "no token" } });
      return;
    }
    await finishJob(admin, jobId, {
      status: "failed",
      error: e instanceof Error ? e.message : String(e),
    });
    console.error(
      `[samsara-sched] ${kind} failed for org ${orgId}:`,
      e instanceof Error ? e.message : e,
    );
  } finally {
    stopHeartbeat();
  }
}

/** A generic tier loop: first run shortly after boot, then on its own interval; never overlaps itself. */
export function startTier(
  env: Env,
  label: string,
  firstDelayMs: number,
  intervalMs: number,
  runAllOrgs: (admin: SupabaseClient) => Promise<void>,
): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runAllOrgs(getSupabaseAdmin(env));
    } catch (e) {
      console.error(`[samsara-sched] ${label} run failed:`, e instanceof Error ? e.message : e);
    } finally {
      running = false;
    }
  };
  setTimeout(run, firstDelayMs);
  setInterval(run, intervalMs);
}

