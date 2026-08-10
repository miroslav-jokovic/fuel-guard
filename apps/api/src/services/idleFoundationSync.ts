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

/** The source stages that must be refreshed before idle rollups are rebuilt. */
export interface IdleFoundationSyncResult {
  idleEvents: IdleSyncResult;
  idleCapabilities: IdleCapabilityResult;
  idleTelemetry: IdleTelemetrySyncResult;
  idleDutyEvidence: IdleDutyEvidenceSyncResult;
  idleEquipmentEvidence: IdleEquipmentEvidenceSyncResult;
  idleLearnedEnvelopes: IdleLearnedEnvelopeSyncResult;
}

/**
 * Refresh the complete idle foundation in a deterministic order.
 *
 * Both scheduled and user-triggered idle syncs use this function so capability learning cannot silently
 * diverge from the idle-event refresh path. HOS syncing and the final rollup remain follow-up stages; the
 * duty overlay here reconciles against the latest complete HOS window already stored.
 */
export async function syncIdleFoundation(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  opts: { sinceDays?: number } = {},
): Promise<IdleFoundationSyncResult> {
  const idleEvents = await syncIdleEvents(admin, env, orgId, { sinceDays: opts.sinceDays });
  const idleCapabilities = await syncIdleCapabilities(admin, env, orgId, {
    sinceDays: opts.sinceDays,
  });
  const idleTelemetry = await syncIdleTelemetry(admin, env, orgId, { sinceDays: opts.sinceDays });
  const idleDutyEvidence = await syncIdleDutyEvidence(admin, orgId, { sinceDays: opts.sinceDays });
  const idleEquipmentEvidence = await syncIdleEquipmentEvidence(admin, orgId, {
    sinceDays: opts.sinceDays,
  });
  const idleLearnedEnvelopes = await syncIdleLearnedEnvelopes(admin, orgId, { sinceDays: 400 });
  return {
    idleEvents,
    idleCapabilities,
    idleTelemetry,
    idleDutyEvidence,
    idleEquipmentEvidence,
    idleLearnedEnvelopes,
  };
}
