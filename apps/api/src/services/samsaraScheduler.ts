import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { syncVehiclesFromSamsara, syncVehicleStatsFromSamsara, NoSamsaraTokenError } from "./samsaraVehicleSync.js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";
import { syncRecentDriverScoreWeeks } from "./driverScoreSync.js";
import { snapshotSettledWeeks } from "./driverPerformanceSnapshot.js";
import { syncIdleEvents } from "./idleSync.js";
import { startJob, finishJob, JobConflictError, type JobKind } from "./jobs.js";

/** Orgs to auto-sync: those with a per-org token, plus all orgs when a single-tenant env token is set. */
async function orgsToSync(admin: SupabaseClient, env: Env): Promise<string[]> {
  const set = new Set<string>();
  const { data: creds } = await admin
    .from("integration_credentials")
    .select("org_id, samsara_api_token, enabled");
  for (const c of creds ?? []) {
    if (c.enabled !== false && c.samsara_api_token) set.add(c.org_id as string);
  }
  if (env.SAMSARA_API_TOKEN) {
    const { data: orgs } = await admin.from("organizations").select("id");
    for (const o of orgs ?? []) set.add(o.id as string);
  }
  return [...set];
}

/**
 * Run one org's tier through the jobs ledger: claim the (org, kind) slot (so a manual run or a still-
 * running prior tick can't overlap), do the work, and record done/failed with stats. A conflict just
 * means "already running" → skip quietly. NoSamsaraToken records as done+skipped, not a failure.
 */
async function runOrgTier(
  admin: SupabaseClient,
  orgId: string,
  kind: JobKind,
  work: () => Promise<Record<string, unknown>>,
): Promise<void> {
  let jobId: string;
  try {
    jobId = await startJob(admin, orgId, kind); // scheduler runs have no requested_by
  } catch (e) {
    if (e instanceof JobConflictError) return; // a run of this kind is already active for the org
    console.error(`[samsara-sched] ${kind} start failed for org ${orgId}:`, e instanceof Error ? e.message : e);
    return;
  }
  try {
    const stats = await work();
    await finishJob(admin, jobId, { status: "done", stats });
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) {
      await finishJob(admin, jobId, { status: "done", stats: { skipped: "no token" } });
      return;
    }
    await finishJob(admin, jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
    console.error(`[samsara-sched] ${kind} failed for org ${orgId}:`, e instanceof Error ? e.message : e);
  }
}

/** A generic tier loop: first run shortly after boot, then on its own interval; never overlaps itself. */
function startTier(
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

/**
 * Start the tiered Samsara schedulers (in-process on the single Railway instance):
 *  - **Live stats** (odometer + fuel level) every SAMSARA_STATS_SYNC_MINUTES — cheap, kept fresh.
 *  - **Identity** (vehicles, drivers, assignments) every SAMSARA_IDENTITY_SYNC_HOURS — slow-changing.
 * Both run through the jobs ledger (freshness + no-overlap) and the rate-limited Samsara client.
 * SAMSARA_SYNC_HOURS=0 remains a kill switch that disables ALL sync (manual buttons still work).
 */
export function startSamsaraScheduler(env: Env): void {
  if (env.SAMSARA_SYNC_HOURS === 0) return; // legacy kill switch → disable all Samsara scheduling
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // not configured (e.g. local dev)

  const statsMs = env.SAMSARA_STATS_SYNC_MINUTES * 60_000;
  const identityMs = env.SAMSARA_IDENTITY_SYNC_HOURS * 3_600_000;

  // Tier 1 — live stats. Shares the "sync_vehicles" slot? No: distinct kind so it never blocks identity.
  startTier(env, "stats", 30_000, statsMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, orgId, "sync_stats", async () => {
        const r = await syncVehicleStatsFromSamsara(admin, env, orgId);
        return { updated: r.updated };
      });
    }
  });

  // Tier 2 — identity (drivers first so assignments resolve). Uses the "sync_vehicles" kind so a manual
  // "Sync from Samsara" and this scheduled refresh share ONE active-run slot (no concurrent double-sync).
  startTier(env, "identity", 90_000, identityMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, orgId, "sync_vehicles", async () => {
        try { await syncDriversFromSamsara(admin, env, orgId); } catch { /* non-fatal */ }
        const r = await syncVehiclesFromSamsara(admin, env, orgId);
        await admin.from("integration_credentials").update({ last_synced_at: new Date().toISOString() }).eq("org_id", orgId);
        return { total: r.total, created: r.created, updated: r.updated, assigned: r.assigned };
      });
    }
  });

  // Tier 3 — driver performance: refresh the current week's Safety+Efficiency scores, then freeze any settled
  // weeks into the rewards ledger. Both run through the jobs ledger (no overlap); efficiency degrades gracefully.
  const driverScoreMs = env.SAMSARA_DRIVER_SCORE_SYNC_HOURS * 3_600_000;
  startTier(env, "driver-scores", 120_000, driverScoreMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, orgId, "sync_driver_scores", async () => {
        const r = await syncRecentDriverScoreWeeks(admin, env, orgId);
        return { weeks: r.weeks, upserted: r.totalUpserted };
      });
      await runOrgTier(admin, orgId, "sync_idle", async () => {
        const r = await syncIdleEvents(admin, env, orgId);
        return { fetched: r.fetched, upserted: r.upserted };
      });
      await runOrgTier(admin, orgId, "snapshot_driver_week", async () => {
        const r = await snapshotSettledWeeks(admin, env, orgId);
        return { weeksFrozen: r.weeksFrozen.length, rowsWritten: r.rowsWritten };
      });
    }
  });

  console.log(
    `[samsara-sched] tiered sync enabled — stats every ${env.SAMSARA_STATS_SYNC_MINUTES}m, identity every ${env.SAMSARA_IDENTITY_SYNC_HOURS}h`,
  );
}
