import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env.js";
import { syncIdleEvents, type IdleSyncResult } from "./idleSync.js";
import { syncIdleCapabilities, type IdleCapabilityResult } from "./idleCapabilitySync.js";
import { syncIdleTelemetry, type IdleTelemetrySyncResult } from "./idleTelemetrySync.js";
import { syncIdleDutyEvidence, type IdleDutyEvidenceSyncResult } from "./idleDutyEvidenceSync.js";
import {
  syncIdleEquipmentEvidence,
  type IdleEquipmentEvidenceSyncResult,
} from "./idleEquipmentEvidenceSync.js";
import {
  syncIdleLearnedEnvelopes,
  type IdleLearnedEnvelopeSyncResult,
} from "./idleLearnedEnvelopeSync.js";
import { IDLE_SOURCE_WINDOW_DAYS } from "./idleWindow.js";

/** Windows at most this deep run as ONE pass (the shape every scheduled sync uses). Deeper windows are
 *  backfills and are chunked into slices, oldest → newest — see the WHY on syncIdleFoundation. */
const SINGLE_PASS_MAX_DAYS = IDLE_SOURCE_WINDOW_DAYS + 15;
const SLICE_DAYS = IDLE_SOURCE_WINDOW_DAYS;
const DAY_MS = 86_400_000;

/** Wall-clock ms per stage, in run order. Reported in the job's stats. */
export type IdleFoundationStage =
  | "idleEvents"
  | "idleCapabilities"
  | "idleTelemetry"
  | "idleDutyEvidence"
  | "idleEquipmentEvidence"
  | "idleLearnedEnvelopes";

/** The source stages that must be refreshed before idle rollups are rebuilt. */
export interface IdleFoundationSyncResult {
  idleEvents: IdleSyncResult;
  idleCapabilities: IdleCapabilityResult;
  idleTelemetry: IdleTelemetrySyncResult;
  idleDutyEvidence: IdleDutyEvidenceSyncResult;
  idleEquipmentEvidence: IdleEquipmentEvidenceSyncResult;
  idleLearnedEnvelopes: IdleLearnedEnvelopeSyncResult;
  /** Per-stage wall clock, and — when a stage throws — which one. */
  stageMs: Partial<Record<IdleFoundationStage, number>>;
}

/**
 * Refresh the complete idle foundation in a deterministic order.
 *
 * Both scheduled and user-triggered idle syncs use this function so capability learning cannot silently
 * diverge from the idle-event refresh path. HOS syncing and the final rollup remain follow-up stages; the
 * duty overlay here reconciles against the latest complete HOS window already stored.
 *
 * EVERY stage is timed, and a stage that throws is named in the error. This job runs for tens of minutes
 * across six stages against two systems; when it failed, the ledger showed one line of SQL text and no
 * indication of which stage produced it or how long the run had spent before getting there (incident
 * 2026-08-10 — "it gets stuck and then fails 40 minutes later"). The timings are cheap and they turn the
 * next failure into a diagnosis instead of an investigation.
 *
 * DEEP WINDOWS ARE CHUNKED (backfill, 2026-08-12). A `sinceDays` beyond SINGLE_PASS_MAX_DAYS is
 * processed as 30-day slices, OLDEST → NEWEST, each an explicit [end − 30d, end) window through the
 * same stage functions:
 *  - One monolithic 120-day pass would trip the engine-states page cap (the fetcher rightly throws on
 *    truncation rather than reconcile from a partial read) and put hours behind a single failure.
 *    Slices bound each fetch to the same window every scheduled sync already proves out daily.
 *  - Every slice's writes are day-/session-keyed upserts with window-scoped reconciliation, so a
 *    failed run is safely re-runnable: completed slices are idempotent re-writes, not duplicates.
 *  - Vehicle-level capability learning is SKIPPED on historical slices (see syncIdleCapabilities
 *    opts) and telemetry runs only for the newest window — both describe the truck's CURRENT state
 *    and must not be regressed by months-old data. Oldest→newest ordering makes the final slice's
 *    view the one that lands last even if an earlier attempt was interrupted.
 *  - The learned-envelope stage runs ONCE at the end over its own 400-day read — it is the primary
 *    beneficiary of the backfilled history (0/190 trucks had sufficient envelope evidence when only
 *    30 days of park sessions existed).
 */
export async function syncIdleFoundation(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { sinceDays?: number } = {},
): Promise<IdleFoundationSyncResult> {
  const stageMs: Partial<Record<IdleFoundationStage, number>> = {};
  // Accumulates rather than overwrites: in sliced (backfill) mode one stage runs once per slice.
  const stage = async <T>(name: IdleFoundationStage, run: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      const result = await run();
      stageMs[name] = (stageMs[name] ?? 0) + (Date.now() - startedAt);
      return result;
    } catch (e) {
      const attemptMs = Date.now() - startedAt;
      stageMs[name] = (stageMs[name] ?? 0) + attemptMs;
      const elapsed = Object.values(stageMs).reduce((a, b) => a + b, 0);
      throw new Error(
        `idle foundation stage "${name}" failed after ${Math.round(attemptMs / 1000)}s ` +
          `(${Math.round(elapsed / 1000)}s into the run; stages so far ${JSON.stringify(stageMs)}): ` +
          `${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    }
  };

  const days = opts.sinceDays ?? IDLE_SOURCE_WINDOW_DAYS;

  if (days <= SINGLE_PASS_MAX_DAYS) {
    const idleEvents = await stage("idleEvents", () =>
      syncIdleEvents(admin, env, orgId, { sinceDays: opts.sinceDays }),
    );
    const idleCapabilities = await stage("idleCapabilities", () =>
      syncIdleCapabilities(admin, env, orgId, { sinceDays: opts.sinceDays }),
    );
    const idleTelemetry = await stage("idleTelemetry", () =>
      syncIdleTelemetry(admin, env, orgId, { sinceDays: opts.sinceDays }),
    );
    const idleDutyEvidence = await stage("idleDutyEvidence", () =>
      syncIdleDutyEvidence(admin, orgId, { sinceDays: opts.sinceDays }),
    );
    const idleEquipmentEvidence = await stage("idleEquipmentEvidence", () =>
      syncIdleEquipmentEvidence(admin, orgId, { sinceDays: opts.sinceDays }),
    );
    const idleLearnedEnvelopes = await stage("idleLearnedEnvelopes", () =>
      syncIdleLearnedEnvelopes(admin, orgId, { sinceDays: 400 }),
    );
    return {
      idleEvents,
      idleCapabilities,
      idleTelemetry,
      idleDutyEvidence,
      idleEquipmentEvidence,
      idleLearnedEnvelopes,
      stageMs,
    };
  }

  // ── Chunked backfill path ─────────────────────────────────────────────────────────────────────
  // Build slices from the window END backwards so the FINAL slice is exactly the newest 30 days (the
  // shape the scheduled sync runs), then reverse to execute oldest → newest. The oldest slice absorbs
  // the partial remainder.
  const endMs = Date.now();
  const slices: { endIso: string; days: number; final: boolean }[] = [];
  let remaining = days;
  let cursor = endMs;
  while (remaining > 0) {
    const sliceDays = Math.min(SLICE_DAYS, remaining);
    slices.push({
      endIso: new Date(cursor).toISOString(),
      days: sliceDays,
      final: cursor === endMs,
    });
    cursor -= sliceDays * DAY_MS;
    remaining -= sliceDays;
  }
  slices.reverse();

  const idleEvents: IdleSyncResult = { fetched: 0, upserted: 0 };
  let idleCapabilities: IdleCapabilityResult | null = null;
  const capabilityRowSums = {
    engineDays: 0,
    parkSessions: 0,
    staleEngineDaysDeleted: 0,
    staleParkSessionsDeleted: 0,
    batches: 0,
  };
  const idleDutyEvidence: IdleDutyEvidenceSyncResult = {
    sessions: 0,
    sufficient: 0,
    insufficient: 0,
    ambiguous: 0,
    rowsWritten: 0,
  };
  const idleEquipmentEvidence: IdleEquipmentEvidenceSyncResult = {
    sessions: 0,
    inside: 0,
    outside: 0,
    mixed: 0,
    insufficient: 0,
    ambiguous: 0,
    notApplicable: 0,
    unknown: 0,
    rowsWritten: 0,
  };

  for (const slice of slices) {
    console.log(
      `[idle-foundation] backfill slice ${slices.indexOf(slice) + 1}/${slices.length} — ${slice.days}d ending ${slice.endIso}`,
    );
    const ev = await stage("idleEvents", () =>
      syncIdleEvents(admin, env, orgId, { sinceDays: slice.days, endIso: slice.endIso }),
    );
    idleEvents.fetched += ev.fetched;
    idleEvents.upserted += ev.upserted;

    const cap = await stage("idleCapabilities", () =>
      syncIdleCapabilities(admin, env, orgId, {
        sinceDays: slice.days,
        endIso: slice.endIso,
        skipVehicleLearning: !slice.final,
      }),
    );
    capabilityRowSums.engineDays += cap.engineDays;
    capabilityRowSums.parkSessions += cap.parkSessions;
    capabilityRowSums.staleEngineDaysDeleted += cap.staleEngineDaysDeleted;
    capabilityRowSums.staleParkSessionsDeleted += cap.staleParkSessionsDeleted;
    capabilityRowSums.batches += cap.batches;
    if (slice.final) idleCapabilities = cap; // final slice's vehicle-level view is the current one

    const duty = await stage("idleDutyEvidence", () =>
      syncIdleDutyEvidence(admin, orgId, { sinceDays: slice.days, endIso: slice.endIso }),
    );
    idleDutyEvidence.sessions += duty.sessions;
    idleDutyEvidence.sufficient += duty.sufficient;
    idleDutyEvidence.insufficient += duty.insufficient;
    idleDutyEvidence.ambiguous += duty.ambiguous;
    idleDutyEvidence.rowsWritten += duty.rowsWritten;

    const equip = await stage("idleEquipmentEvidence", () =>
      syncIdleEquipmentEvidence(admin, orgId, { sinceDays: slice.days, endIso: slice.endIso }),
    );
    idleEquipmentEvidence.sessions += equip.sessions;
    idleEquipmentEvidence.inside += equip.inside;
    idleEquipmentEvidence.outside += equip.outside;
    idleEquipmentEvidence.mixed += equip.mixed;
    idleEquipmentEvidence.insufficient += equip.insufficient;
    idleEquipmentEvidence.ambiguous += equip.ambiguous;
    idleEquipmentEvidence.notApplicable += equip.notApplicable;
    idleEquipmentEvidence.unknown += equip.unknown;
    idleEquipmentEvidence.rowsWritten += equip.rowsWritten;
  }

  // Telemetry describes the CURRENT windows only — one pass over the standard window.
  const idleTelemetry = await stage("idleTelemetry", () =>
    syncIdleTelemetry(admin, env, orgId, {}),
  );
  const idleLearnedEnvelopes = await stage("idleLearnedEnvelopes", () =>
    syncIdleLearnedEnvelopes(admin, orgId, { sinceDays: 400 }),
  );

  const finalCap = idleCapabilities!;
  return {
    idleEvents,
    idleCapabilities: { ...finalCap, ...capabilityRowSums },
    idleTelemetry,
    idleDutyEvidence,
    idleEquipmentEvidence,
    idleLearnedEnvelopes,
    stageMs,
  };
}
