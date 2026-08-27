import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../../env.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import {
  syncVehiclesFromSamsara,
  syncVehicleStatsFromSamsara,
  NoSamsaraTokenError,
} from "./samsaraVehicleSync.js";
import { syncDriversFromSamsara } from "./samsaraDriverSync.js";
import { syncRecentDriverScoreWeeks } from "../performance/index.js";
import { snapshotSettledWeeks } from "../performance/index.js";
import { syncIdleFoundation } from "../idle/index.js";
import { syncHosDutySegments, syncHosCurrentStatus } from "../../services/hosSync.js";
import { syncIdleRollup } from "../idle/index.js";
import { syncIdleDutyEvidence } from "../idle/index.js";
import { runDataRetention } from "../../services/dataRetention.js";
import { startJob, finishJob, startJobHeartbeat, JobConflictError, type JobKind } from "../../services/jobs.js";
import { enqueueJob } from "../../services/queue/enqueue.js";
import { monthsToSync, syncIftaMilesForMonth } from "./samsaraIftaSync.js";

/** Orgs to auto-sync: those with a per-org token, plus — when the single-tenant env token is set —
 *  the OLDEST org only (2026-08 incident: the fallback used to include EVERY org row, so a stray org
 *  created by dev seed data started syncing the entire real fleet in parallel — duplicate vehicles,
 *  doubled DB load. An env token is single-tenant by definition; it belongs to exactly one org, and
 *  the oldest row is the real tenant by construction — strays are always created later). */
async function orgsToSync(admin: SupabaseClient, env: Env): Promise<string[]> {
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
async function runOrgTier(
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
      await runOrgTier(admin, env, orgId, "sync_stats", async () => {
        const r = await syncVehicleStatsFromSamsara(admin, env, orgId);
        return { updated: r.updated };
      });
    }
  });

  // Tier 2 — identity (drivers first so assignments resolve). Uses the "sync_vehicles" kind so a manual
  // "Sync from Samsara" and this scheduled refresh share ONE active-run slot (no concurrent double-sync).
  startTier(env, "identity", 90_000, identityMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_vehicles", async () => {
        try {
          await syncDriversFromSamsara(admin, env, orgId);
        } catch {
          /* non-fatal */
        }
        const r = await syncVehiclesFromSamsara(admin, env, orgId);
        await admin
          .from("integration_credentials")
          .update({ last_synced_at: new Date().toISOString() })
          .eq("org_id", orgId);
        return { total: r.total, created: r.created, updated: r.updated, assigned: r.assigned };
      });
    }
  });

  // Tier 3 — driver performance: refresh the current week's Safety+Efficiency scores, then freeze any settled
  // weeks into the rewards ledger. Both run through the jobs ledger (no overlap); efficiency degrades gracefully.
  const driverScoreMs = env.SAMSARA_DRIVER_SCORE_SYNC_HOURS * 3_600_000;
  startTier(env, "driver-scores", 120_000, driverScoreMs, async (admin) => {
    for (const orgId of await orgsToSync(admin, env)) {
      await runOrgTier(admin, env, orgId, "sync_driver_scores", async () => {
        const r = await syncRecentDriverScoreWeeks(admin, env, orgId);
        return { weeks: r.weeks, upserted: r.totalUpserted };
      });
      await runOrgTier(admin, env, orgId, "sync_idle", async () => {
        const r = await syncIdleFoundation(admin, env, orgId);
        return {
          stageMs: r.stageMs,
          fetched: r.idleEvents.fetched,
          upserted: r.idleEvents.upserted,
          capabilityVehicles: r.idleCapabilities.vehicles,
          capabilityLearned: r.idleCapabilities.learned,
          capabilityVehiclesWithData: r.idleCapabilities.vehiclesWithData,
          capabilityVehiclesWithoutData: r.idleCapabilities.vehiclesWithoutData,
          capabilityBatches: r.idleCapabilities.batches,
          engineDaysWritten: r.idleCapabilities.engineDays,
          parkSessionsWritten: r.idleCapabilities.parkSessions,
          staleEngineDaysDeleted: r.idleCapabilities.staleEngineDaysDeleted,
          staleParkSessionsDeleted: r.idleCapabilities.staleParkSessionsDeleted,
          telemetryVehicles: r.idleTelemetry.vehicles,
          telemetryVehiclesWithData: r.idleTelemetry.vehiclesWithTelemetry,
          telemetryWindowsWritten: r.idleTelemetry.windowsWritten,
          telemetrySamples: r.idleTelemetry.samples,
          equipmentEvidenceSessions: r.idleEquipmentEvidence.sessions,
          equipmentEvidenceInside: r.idleEquipmentEvidence.inside,
          equipmentEvidenceOutside: r.idleEquipmentEvidence.outside,
          equipmentEvidenceMixed: r.idleEquipmentEvidence.mixed,
          equipmentEvidenceInsufficient: r.idleEquipmentEvidence.insufficient,
          equipmentEvidenceAmbiguous: r.idleEquipmentEvidence.ambiguous,
          equipmentEvidenceUnknown: r.idleEquipmentEvidence.unknown,
          equipmentEvidenceRowsWritten: r.idleEquipmentEvidence.rowsWritten,
          learnedEnvelopeVehicles: r.idleLearnedEnvelopes.vehicles,
          learnedEnvelopeSufficient: r.idleLearnedEnvelopes.sufficient,
          learnedEnvelopeInsufficient: r.idleLearnedEnvelopes.insufficient,
          learnedEnvelopeNotApplicable: r.idleLearnedEnvelopes.notApplicable,
          learnedEnvelopeRowsWritten: r.idleLearnedEnvelopes.rowsWritten,
        };
      });
      // sync_idle and sync_hos keep INDEPENDENT (org, kind) slots. They both touch idle_park_sessions,
      // but each owns a disjoint column group and writes it with a set-based UPDATE (migration 0174), so
      // they converge rather than race. Giving them a shared dedup key instead starved sync_hos outright
      // under JOB_EXECUTION_MODE=queue — see the note in jobs.ts.
      await runOrgTier(admin, env, orgId, "sync_hos", async () => {
        const r = await syncHosDutySegments(admin, env, orgId);
        const dutyEvidence = await syncIdleDutyEvidence(admin, orgId);
        // Same follow-up the manual/queue handler does: stamp each driver's CURRENT duty status, truck and
        // city (clocks + one fleet GPS snapshot). Best-effort — the scheduled job's segment stats stand even
        // if the live-status pass hiccups. Without this the Drivers page only refreshed on a manual click.
        let currentDrivers = 0;
        let located = 0;
        try {
          const c = await syncHosCurrentStatus(admin, env, orgId);
          currentDrivers = c.drivers;
          located = c.located;
        } catch (e) {
          console.error(
            `[samsara-sched] hos current status (org ${orgId}) failed: ${e instanceof Error ? e.message : e}`,
          );
        }
        // Rollup refresh runs ONCE per tier cycle, here after BOTH of its feeds (idle ran earlier in this
        // tier; duty segments just synced above). It is the derived view rendered by Idling, so a failed
        // refresh must fail this ledger job and become visible/retryable instead of leaving stale data.
        const rollup = await syncIdleRollup(admin, orgId);
        return {
          fetched: r.fetched,
          upserted: r.upserted,
          currentDrivers,
          located,
          dutyEvidenceSessions: dutyEvidence.sessions,
          dutyEvidenceSufficient: dutyEvidence.sufficient,
          dutyEvidenceInsufficient: dutyEvidence.insufficient,
          dutyEvidenceAmbiguous: dutyEvidence.ambiguous,
          dutyEvidenceRowsWritten: dutyEvidence.rowsWritten,
          rollupWindowDays: rollup.windowDays,
          rollupRows: rollup.rows,
          rollupWritten: rollup.written,
          rollupDeleted: rollup.deleted,
        };
      });
      await runOrgTier(admin, env, orgId, "snapshot_driver_week", async () => {
        const r = await snapshotSettledWeeks(admin, env, orgId);
        return { weeksFrozen: r.weeksFrozen.length, rowsWritten: r.rowsWritten };
      });
    }
  });

  // Tier 3b — IFTA jurisdiction miles (0255). Daily, and deliberately its own tier rather than a line
  // in tier 3: it is the only Samsara feed whose grain is a MONTH, nothing it reads moves faster than
  // Samsara's 72-hour restatement window, and a tax figure has no business sharing a ledger slot with a
  // driver-score refresh that runs every six hours. `SAMSARA_IFTA_SYNC_HOURS=0` disables it outright.
  if (env.SAMSARA_IFTA_SYNC_HOURS > 0) {
    startTier(env, "ifta", 180_000, env.SAMSARA_IFTA_SYNC_HOURS * 3_600_000, async (admin) => {
      for (const orgId of await orgsToSync(admin, env)) {
        await runOrgTier(admin, env, orgId, "sync_ifta", async () => {
          const months = monthsToSync(new Date());
          const per: Record<string, number> = {};
          let rows = 0;
          let unmapped = 0;
          for (const { year, month } of months) {
            const r = await syncIftaMilesForMonth(admin, env, orgId, year, month);
            per[`${month} ${year}`] = r.rows;
            rows += r.rows;
            unmapped = Math.max(unmapped, r.unmappedVehicles);
          }
          return { months: per, rows, unmappedVehicles: unmapped };
        });
      }
    });
  }

  // Tier 4 — daily data retention (DB-only): enforce the per-table retention policy
  // (services/dataRetention.ts) in bounded batches, through the jobs ledger like every other tier so
  // the run + its per-table delete counts are visible on Data & Sync.
  startTier(env, "retention", 600_000, 24 * 3_600_000, async (admin) => {
    // ALL orgs — retention is not tied to having a Samsara token.
    const { data: orgs } = await admin.from("organizations").select("id");
    for (const orgId of ((orgs ?? []) as { id: string }[]).map((o) => o.id)) {
      await runOrgTier(admin, env, orgId, "data_retention", async () => {
        const r = await runDataRetention(admin, orgId);
        return {
          totalDeleted: r.totalDeleted,
          tables: Object.fromEntries(
            r.tables.filter((t) => t.deleted > 0 || t.capped).map((t) => [t.table, t.deleted]),
          ),
        };
      });
    }
  });

  console.log(
    `[samsara-sched] tiered sync enabled — stats every ${env.SAMSARA_STATS_SYNC_MINUTES}m, identity every ${env.SAMSARA_IDENTITY_SYNC_HOURS}h`,
  );
}
