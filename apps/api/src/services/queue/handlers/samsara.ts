import {
  syncVehiclesFromSamsara,
  syncVehicleStatsFromSamsara,
  NoSamsaraTokenError,
} from "../../samsaraVehicleSync.js";
import { syncTrailersFromSamsara } from "../../samsaraTrailerSync.js";
import { syncIdleEvents } from "../../idleSync.js";
import { syncIdleCapabilities } from "../../idleCapabilitySync.js";
import { syncHosDutySegments, syncHosCurrentStatus } from "../../hosSync.js";
import { syncDriversFromSamsara } from "../../samsaraDriverSync.js";
import { syncDriverScores, syncRecentDriverScoreWeeks } from "../../driverScoreSync.js";
import { snapshotSettledWeeks } from "../../driverPerformanceSnapshot.js";
import { runNightlyReconcile } from "../../nightlyReconcile.js";
import { writeAudit } from "../../../lib/audit.js";
import type { JobHandler } from "../types.js";

/**
 * Samsara / telematics sync + nightly-reconcile handlers (WQ1c). Each reconstructs entirely from
 * `job.payload` (an org id + a couple of small flags), never closure-captured data (plan A2). All of
 * these call the vendor (Samsara) through the rate-limited `samsaraFetch`; in queue mode they run on the
 * consumer under a bounded per-kind cap (plan Q7/Q12), so vendor RPS holds globally across replicas
 * instead of N-per-process.
 *
 * Idempotent (plan Q9): every sync upserts/dedupes by external id, so a retry (lease expiry, requeue)
 * re-fetches and converges on the same rows. A missing Samsara token is NOT a failure — it returns a
 * `{ skipped }` stat (job done), matching the old scheduler behavior and avoiding pointless retries of a
 * non-transient condition. Audit is written ONLY when `payload.actorId` is present (a manual button),
 * mirroring the old route closures; scheduler-origin runs carry no actor and write no audit.
 */
const asStr = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Wrap a best-effort sub-sync: log + swallow so one weak scope (idle, trailers) never fails the job. */
async function nonFatal(label: string, orgId: string, run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e) {
    console.error(
      `[samsara] ${label} (org ${orgId}) failed: ${e instanceof Error ? e.message : e}`,
    );
  }
}

/**
 * Fleet identity sync. `payload.full` distinguishes the two callers that share this (org, kind) slot:
 *  - `full: true` — the manual "Sync fleet identity" button: drivers → vehicles → trailers → idle →
 *    driver-scores, so one click refreshes everything the card promises (sub-syncs best-effort).
 *  - `full` absent — the identity SCHEDULER tier: drivers (best-effort) → vehicles, then stamp
 *    `integration_credentials.last_synced_at`. Idle / driver-scores are their own scheduler tiers, so the
 *    scheduled identity pass must NOT double-run them.
 */
export const syncVehiclesHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const actorId = asStr(job.payload.actorId);
  const full = job.payload.full === true;
  try {
    // Drivers first so samsara_driver_id is populated before the vehicle assignment step.
    await nonFatal("driver sync", orgId, () => syncDriversFromSamsara(admin, env, orgId));
    const result = await syncVehiclesFromSamsara(admin, env, orgId);
    if (full) {
      await nonFatal("trailer sync", orgId, async () => {
        const tr = await syncTrailersFromSamsara(admin, env, orgId);
        console.log(`[samsara] trailer sync: ${tr.total} trailers, ${tr.paired} paired`);
      });
      await nonFatal("idle sync", orgId, () => syncIdleEvents(admin, env, orgId));
      await nonFatal("driver-score sync", orgId, () => syncDriverScores(admin, env, orgId));
    } else {
      await admin
        .from("integration_credentials")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("org_id", orgId);
    }
    if (actorId) {
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "integration.samsara.vehicles_synced",
        entity: "vehicles",
        meta: { total: result.total, created: result.created, updated: result.updated },
      });
    }
    return {
      total: result.total,
      created: result.created,
      updated: result.updated,
      assigned: result.assigned,
      needsCompletion: result.needsCompletion.length,
    };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** Live stats (odometer + fuel level). Scheduler-only tier — cheap, kept fresh; no audit. */
export const syncStatsHandler: JobHandler = async (ctx, job) => {
  try {
    const r = await syncVehicleStatsFromSamsara(ctx.admin, ctx.env, job.org_id);
    return { updated: r.updated };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** Trailers (reefer assets) + reefer↔tractor GPS pairing. */
export const syncTrailersHandler: JobHandler = async (ctx, job) => {
  const actorId = asStr(job.payload.actorId);
  try {
    const result = await syncTrailersFromSamsara(ctx.admin, ctx.env, job.org_id);
    if (actorId) {
      await writeAudit(ctx.admin, {
        orgId: job.org_id,
        actorId,
        action: "integration.samsara.trailers_synced",
        entity: "trailers",
        meta: {
          total: result.total,
          created: result.created,
          updated: result.updated,
          paired: result.paired,
        },
      });
    }
    return {
      total: result.total,
      created: result.created,
      updated: result.updated,
      paired: result.paired,
    };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** HOS duty-status segments (rest vs work context for avoidable idle). `payload.sinceDays` drives a deeper
 *  historical backfill; default is the rolling 30-day window. */
export const syncHosHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const actorId = asStr(job.payload.actorId);
  const sinceDays = asNum(job.payload.sinceDays) ?? undefined;
  try {
    const result = await syncHosDutySegments(admin, env, orgId, { sinceDays });
    let currentDrivers = 0;
    await nonFatal("hos current status", orgId, async () => {
      const c = await syncHosCurrentStatus(admin, env, orgId);
      currentDrivers = c.drivers;
    });
    if (actorId) {
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "integration.samsara.hos_synced",
        entity: "hos_duty_segments",
        meta: { ...result, currentDrivers },
      });
    }
    return { ...result, currentDrivers };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** Idling events + (best-effort) per-truck idle-capability learning. */
export const syncIdleHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const actorId = asStr(job.payload.actorId);
  try {
    const result = await syncIdleEvents(admin, env, orgId);
    let learned = 0;
    await nonFatal("idle capability", orgId, async () => {
      const cap = await syncIdleCapabilities(admin, env, orgId);
      learned = cap.learned;
      console.log(`[samsara] idle capability: ${cap.learned}/${cap.vehicles} trucks classified`);
    });
    if (actorId) {
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "integration.samsara.idle_synced",
        entity: "idle_events",
        meta: { ...result, capabilityLearned: learned },
      });
    }
    return { ...result, capabilityLearned: learned };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** Drivers → drivers table (also runs inside the compound identity sync; standalone for the drivers page). */
export const syncDriversHandler: JobHandler = async (ctx, job) => {
  const actorId = asStr(job.payload.actorId);
  try {
    const result = await syncDriversFromSamsara(ctx.admin, ctx.env, job.org_id);
    if (actorId) {
      await writeAudit(ctx.admin, {
        orgId: job.org_id,
        actorId,
        action: "integration.samsara.drivers_synced",
        entity: "drivers",
        meta: { total: result.total, created: result.created, updated: result.updated },
      });
    }
    return { total: result.total, created: result.created, updated: result.updated };
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** Current-week driver-performance component scores (Safety + Efficiency), + an idle refresh so the grade
 *  is current. Manual "Sync scores" and the driver-score scheduler tier share this slot. */
export const syncDriverScoresHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const actorId = asStr(job.payload.actorId);
  try {
    const result = await syncRecentDriverScoreWeeks(admin, env, orgId);
    // Idle feeds the grade too — the MANUAL "Sync scores" button (payload.refreshIdle) refreshes it so
    // one click makes the whole page current. The driver-score SCHEDULER tier omits the flag because idle
    // is its own scheduled tier — refreshing here too would double-sync it every cycle.
    if (job.payload.refreshIdle === true) {
      await nonFatal("driver-score idle refresh", orgId, () => syncIdleEvents(admin, env, orgId));
    }
    const cur = result.results[0];
    const summary = {
      weekStart: cur?.weekStart ?? null,
      weeks: result.weeks,
      drivers: cur?.drivers ?? 0,
      upserted: result.totalUpserted,
      safetyOk: cur?.safetyOk ?? false,
      efficiencyOk: cur?.efficiencyOk ?? false,
    };
    if (actorId) {
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "integration.samsara.driver_scores_synced",
        entity: "driver_scores",
        meta: summary,
      });
    }
    return summary;
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/** Freeze all settled driver-performance weeks into the rewards ledger. DB-only (no vendor call), idempotent. */
export const snapshotDriverWeekHandler: JobHandler = async (ctx, job) => {
  const actorId = asStr(job.payload.actorId);
  const result = await snapshotSettledWeeks(ctx.admin, ctx.env, job.org_id);
  if (actorId) {
    await writeAudit(ctx.admin, {
      orgId: job.org_id,
      actorId,
      action: "driver_performance.snapshot",
      entity: "driver_performance_weeks",
      meta: { weeksFrozen: result.weeksFrozen.length, rowsWritten: result.rowsWritten },
    });
  }
  return { weeksFrozen: result.weeksFrozen.length, rowsWritten: result.rowsWritten };
};

/** Nightly self-heal: repair the fuel-event store from the EFS source, re-score, rules-only rebuild. */
export const nightlyReconcileHandler: JobHandler = async (ctx, job) => {
  return runNightlyReconcile(ctx.admin, ctx.env, job.org_id);
};
