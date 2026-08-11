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
 */
export async function syncIdleFoundation(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { sinceDays?: number } = {},
): Promise<IdleFoundationSyncResult> {
  const stageMs: Partial<Record<IdleFoundationStage, number>> = {};
  const stage = async <T>(name: IdleFoundationStage, run: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await run();
    } catch (e) {
      stageMs[name] = Date.now() - startedAt;
      const elapsed = Object.values(stageMs).reduce((a, b) => a + b, 0);
      throw new Error(
        `idle foundation stage "${name}" failed after ${Math.round(stageMs[name]! / 1000)}s ` +
          `(${Math.round(elapsed / 1000)}s into the run; stages so far ${JSON.stringify(stageMs)}): ` +
          `${e instanceof Error ? e.message : String(e)}`,
        { cause: e },
      );
    } finally {
      stageMs[name] ??= Date.now() - startedAt;
    }
  };

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
