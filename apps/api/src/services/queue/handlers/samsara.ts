import {
  syncVehiclesFromSamsara,
  syncVehicleStatsFromSamsara,
  NoSamsaraTokenError,
} from "../../samsaraVehicleSync.js";
import { syncTrailersFromSamsara } from "../../samsaraTrailerSync.js";
import { syncIdleFoundation } from "../../idleFoundationSync.js";
import { syncHosDutySegments, syncHosCurrentStatus } from "../../hosSync.js";
import { syncIdleRollup } from "../../idleRollup.js";
import { syncIdleDutyEvidence } from "../../idleDutyEvidenceSync.js";
import { syncDriversFromSamsara } from "../../samsaraDriverSync.js";
import { syncDriverScores, syncRecentDriverScoreWeeks } from "../../driverScoreSync.js";
import { snapshotSettledWeeks } from "../../driverPerformanceSnapshot.js";
import { runNightlyReconcile } from "../../nightlyReconcile.js";
import { writeAudit } from "../../../lib/audit.js";
import type { JobHandler } from "../types.js";
import { monthsToSync, syncIftaMilesForMonth } from "../../samsaraIftaSync.js";

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

/** Wrap an optional sub-sync: log + swallow only where a partial result is still operationally valid. */
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
      await syncIdleFoundation(admin, env, orgId);
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
    const dutyEvidence = await syncIdleDutyEvidence(admin, orgId, { sinceDays });
    let currentDrivers = 0;
    let located = 0;
    await nonFatal("hos current status", orgId, async () => {
      const c = await syncHosCurrentStatus(admin, env, orgId);
      currentDrivers = c.drivers;
      located = c.located;
    });
    // The rollup is the derived view rendered by Idling. A successful source sync with a stale rollup is
    // not a successful job, so let this error reject the job and use the queue retry policy.
    const rollup = await syncIdleRollup(admin, orgId);
    if (actorId) {
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "integration.samsara.hos_synced",
        entity: "hos_duty_segments",
        meta: {
          ...result,
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
        },
      });
    }
    return {
      ...result,
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
  } catch (e) {
    if (e instanceof NoSamsaraTokenError) return { skipped: "no_samsara_token" };
    throw e;
  }
};

/**
 * Samsara IFTA jurisdiction miles — the current month and the two before it (S1).
 *
 * Three months rather than one because a carrier files a QUARTER, and the month a quarter opens is
 * still being restated while the next one runs. Each month is its own fetch and its own row in
 * `samsara_ifta_fetches`, so a partial run leaves the months it did complete intact and says which.
 */
export const syncIftaHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const actorId = asStr(job.payload.actorId);
  const months = monthsToSync(new Date());
  const done: Record<string, number> = {};
  let rows = 0;
  let unmapped = 0;
  const failed: string[] = [];
  for (const { year, month } of months) {
    // Each month is its own request and its own fetch row, so one refusal must not cost the others.
    // Before this guard the loop threw on the first month and the rest were never attempted — which
    // mattered, because Samsara 400s an in-progress month outright (see `monthsToSync`).
    let r;
    try {
      r = await syncIftaMilesForMonth(admin, env, orgId, year, month, { actorId });
    } catch (e) {
      failed.push(`${month} ${year}: ${e instanceof Error ? e.message : String(e)}`);
      console.error(`[samsara] ifta ${month} ${year} failed: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    done[`${month} ${year}`] = r.rows;
    rows += r.rows;
    unmapped = Math.max(unmapped, r.unmappedVehicles);
    if (r.unmappedVehicles > 0) {
      // Samsara reporting trucks we do not hold means the fleet and the telematics account disagree
      // about what exists. Loud, because it silently shrinks every jurisdiction total.
      console.warn(`[samsara] ifta ${month} ${year}: ${r.unmappedVehicles} vehicle(s) could not be mapped`);
    }
  }
  // A run where EVERY month failed is a failed run: returning a tidy zero would leave the ledger empty
  // and the job green, which is the pair of facts that hides an outage.
  if (failed.length === months.length) throw new Error(`Every IFTA month failed — ${failed.join("; ")}`);
  return { months: done, rows, unmappedVehicles: unmapped, failed };
};

/** Idling events + complete per-truck idle-capability foundation refresh. */
export const syncIdleHandler: JobHandler = async (ctx, job) => {
  const { admin, env } = ctx;
  const orgId = job.org_id;
  const actorId = asStr(job.payload.actorId);
  const sinceDays = asNum(job.payload.sinceDays) ?? undefined;
  try {
    const foundation = await syncIdleFoundation(admin, env, orgId, { sinceDays });
    const result = foundation.idleEvents;
    const cap = foundation.idleCapabilities;
    const telemetry = foundation.idleTelemetry;
    const equipment = foundation.idleEquipmentEvidence;
    console.log(`[samsara] idle capability: ${cap.learned}/${cap.vehicles} trucks classified`);
    // The rollup is the derived view rendered by Idling. A successful source sync with a stale rollup is
    // not a successful job, so let this error reject the job and use the queue retry policy. A deep
    // (backfill) window is passed through so the rollup materializes the whole backfilled span — its
    // stale-row deletion is window-scoped, so subsequent rolling 30-day runs never touch that history.
    const rollup = await syncIdleRollup(admin, orgId, sinceDays != null ? { sinceDays } : {});
    console.log(
      `[samsara] idle rollup: ${rollup.written}/${rollup.rows} day-rows written, ${rollup.deleted} stale rows deleted (${rollup.windowDays}d window)`,
    );
    if (actorId) {
      await writeAudit(admin, {
        orgId,
        actorId,
        action: "integration.samsara.idle_synced",
        entity: "idle_events",
        meta: {
          ...result,
          capabilityLearned: cap.learned,
          capabilityVehicles: cap.vehicles,
          capabilityVehiclesWithData: cap.vehiclesWithData,
          capabilityVehiclesWithoutData: cap.vehiclesWithoutData,
          capabilityBatches: cap.batches,
          engineDaysWritten: cap.engineDays,
          parkSessionsWritten: cap.parkSessions,
          staleEngineDaysDeleted: cap.staleEngineDaysDeleted,
          staleParkSessionsDeleted: cap.staleParkSessionsDeleted,
          telemetryVehicles: telemetry.vehicles,
          telemetryVehiclesWithData: telemetry.vehiclesWithTelemetry,
          telemetryWindowsWritten: telemetry.windowsWritten,
          telemetrySamples: telemetry.samples,
          equipmentEvidenceSessions: equipment.sessions,
          equipmentEvidenceInside: equipment.inside,
          equipmentEvidenceOutside: equipment.outside,
          equipmentEvidenceMixed: equipment.mixed,
          equipmentEvidenceInsufficient: equipment.insufficient,
          equipmentEvidenceAmbiguous: equipment.ambiguous,
          equipmentEvidenceUnknown: equipment.unknown,
          equipmentEvidenceRowsWritten: equipment.rowsWritten,
          learnedEnvelopeVehicles: foundation.idleLearnedEnvelopes.vehicles,
          learnedEnvelopeSufficient: foundation.idleLearnedEnvelopes.sufficient,
          learnedEnvelopeInsufficient: foundation.idleLearnedEnvelopes.insufficient,
          learnedEnvelopeNotApplicable: foundation.idleLearnedEnvelopes.notApplicable,
          learnedEnvelopeRowsWritten: foundation.idleLearnedEnvelopes.rowsWritten,
          rollupWindowDays: rollup.windowDays,
          rollupRows: rollup.rows,
          rollupWritten: rollup.written,
          rollupDeleted: rollup.deleted,
        },
      });
    }
    return {
      ...result,
      stageMs: foundation.stageMs,
      capabilityLearned: cap.learned,
      capabilityVehicles: cap.vehicles,
      capabilityVehiclesWithData: cap.vehiclesWithData,
      capabilityVehiclesWithoutData: cap.vehiclesWithoutData,
      capabilityBatches: cap.batches,
      engineDaysWritten: cap.engineDays,
      parkSessionsWritten: cap.parkSessions,
      staleEngineDaysDeleted: cap.staleEngineDaysDeleted,
      staleParkSessionsDeleted: cap.staleParkSessionsDeleted,
      telemetryVehicles: telemetry.vehicles,
      telemetryVehiclesWithData: telemetry.vehiclesWithTelemetry,
      telemetryWindowsWritten: telemetry.windowsWritten,
      telemetrySamples: telemetry.samples,
      equipmentEvidenceSessions: equipment.sessions,
      equipmentEvidenceInside: equipment.inside,
      equipmentEvidenceOutside: equipment.outside,
      equipmentEvidenceMixed: equipment.mixed,
      equipmentEvidenceInsufficient: equipment.insufficient,
      equipmentEvidenceAmbiguous: equipment.ambiguous,
      equipmentEvidenceUnknown: equipment.unknown,
      equipmentEvidenceRowsWritten: equipment.rowsWritten,
      learnedEnvelopeVehicles: foundation.idleLearnedEnvelopes.vehicles,
      learnedEnvelopeSufficient: foundation.idleLearnedEnvelopes.sufficient,
      learnedEnvelopeInsufficient: foundation.idleLearnedEnvelopes.insufficient,
      learnedEnvelopeNotApplicable: foundation.idleLearnedEnvelopes.notApplicable,
      learnedEnvelopeRowsWritten: foundation.idleLearnedEnvelopes.rowsWritten,
      rollupWindowDays: rollup.windowDays,
      rollupRows: rollup.rows,
      rollupWritten: rollup.written,
      rollupDeleted: rollup.deleted,
    };
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
      await nonFatal("driver-score idle refresh", orgId, () =>
        syncIdleFoundation(admin, env, orgId),
      );
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
