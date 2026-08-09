/** Scoring persistence: atomic anomaly reconciliation + transaction outcome, then vehicle learning. */
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  correlateSignals,
  computedMpg,
  computeFillConfidence,
  effectiveBaseline,
  milesSinceLast,
  summarizeFillGates,
  type AttributionCheck,
  type RuleContext,
  type RuleResult,
  type TxnView,
  type VehicleView,
} from "@fuelguard/shared";
import { getBuildInfo } from "../../lib/buildInfo.js";
import type { ReconResult } from "./reconcile.js";
import { learnVehicleValues } from "./learnVehicle.js";
import type { ScoreOpts } from "./loaders.js";

type Assessment = ReturnType<typeof correlateSignals>;

export interface TxnOutcomeArgs {
  txn: TxnView;
  previousTxn: TxnView | null;
  intermediateGallons: number;
  assessment: Assessment;
  ruleCtx: RuleContext;
  recon: ReconResult;
  /** WP-ATTR — the fill's logbook attribution check, persisted for the UI/data-quality surfaces. */
  attribution: AttributionCheck;
}

export interface ScoringAttempt {
  id: string;
  engineVersion: string;
  resultHash: string;
}

/** Current deployed code identity, used to make persisted scoring results reproducible. */
export function scoringEngineVersion(): string {
  return getBuildInfo().commit ?? "unknown";
}

function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = normalize((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

/** Stable digest of the exact persistence payload sent to the database RPC. */
export function scoringResultHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

/** Convert the computed outcome to the snake_case JSON contract consumed by Postgres. */
export function buildTxnOutcomePatch(a: TxnOutcomeArgs): Record<string, unknown> {
  const { txn, previousTxn, intermediateGallons, assessment, ruleCtx, recon, attribution } = a;
  return {
    miles_since_last: milesSinceLast(txn, previousTxn),
    computed_mpg: computedMpg(txn, previousTxn, intermediateGallons),
    has_anomaly: assessment.level !== "clear",
    max_severity: assessment.severity,
    // WP2 "why" surface: persist the outcome even when clear, so sub-threshold signals stay visible.
    case_level: assessment.level,
    case_score: assessment.score,
    case_signals: assessment.signals,
    // WP6: WHY detection was limited on this fill (ineligible rules + the gating inputs).
    case_gates: { ...summarizeFillGates(computeFillConfidence(ruleCtx)), fuel_balance: ruleCtx.fuelBalance ?? null },
    // WP-ATTR: the logbook attribution verdict (+ the contradicting logbook truck when suspect).
    attribution_verdict: attribution.verdict,
    logbook_vehicle_id: attribution.verdict === "suspect" ? attribution.logbookVehicleId : null,
    samsara_odometer: recon.crossSourceOdometer,
    samsara_odometer_at: recon.crossSourceOdometerAt,
    samsara_odometer_source: recon.crossSourceOdometerSource,
    samsara_location_matched: recon.samsaraLocationMatched,
    samsara_location_confidence: recon.locationConfidence,
    samsara_nearest_station_miles: recon.nearestStationMiles,
    station_lat: recon.stationLat,
    station_lng: recon.stationLng,
    samsara_tank_short_gal: recon.tankFillShortGal,
    samsara_tank_observed_gal: recon.tankObservedRiseGal,
    samsara_fuel_pct_before: recon.tankPctBefore,
    samsara_fuel_pct_after: recon.tankPctAfter,
    samsara_observed_state: recon.observedState,
    samsara_observed_city: recon.observedCity,
    samsara_observed_address: recon.observedAddress,
    samsara_observed_lat: recon.observedLat,
    samsara_observed_lng: recon.observedLng,
    fueling_time_basis: recon.fuelingTimeBasis,
    // The telematics-recovered instant is stored here, never over fueled_at.
    samsara_recon_at: recon.reconAt,
    samsara_recon_checked_at: recon.reconCheckedAt,
    samsara_recon_status: recon.reconStatus,
    samsara_recon_error: recon.reconError,
    samsara_recon_evidence_version: recon.reconEvidenceVersion,
  };
}

function casePayload(caseFired: RuleResult[]): Record<string, unknown> | null {
  const result = caseFired[0];
  if (!result) return null;
  return {
    rule_id: result.ruleId,
    severity: result.severity,
    message: result.message,
    evidence: result.evidence,
  };
}

/** Create the durable attempt before the atomic persistence call begins. */
export async function startScoringAttempt(
  admin: SupabaseClient,
  input: { orgId: string; txnId: string; engineVersion: string; resultHash: string },
): Promise<ScoringAttempt> {
  const id = randomUUID();
  const { data, error } = await admin
    .from("scoring_attempts")
    .insert({
      id,
      org_id: input.orgId,
      transaction_id: input.txnId,
      engine_version: input.engineVersion,
      result_hash: input.resultHash,
      status: "running",
    })
    .select("id")
    .single();
  if (error) throw new Error(`[scoring] could not start attempt ${id}: ${error.message}`);
  if (!data?.id) throw new Error(`[scoring] could not start attempt ${id}: no attempt id returned`);
  return { id: data.id as string, engineVersion: input.engineVersion, resultHash: input.resultHash };
}

/** Mark a failed persistence attempt. The original scoring error remains the primary failure. */
export async function failScoringAttempt(
  admin: SupabaseClient,
  attemptId: string,
  errorMessage: string,
): Promise<void> {
  const { data, error } = await admin
    .from("scoring_attempts")
    .update({ status: "failed", error: errorMessage, completed_at: new Date().toISOString() })
    .eq("id", attemptId)
    .eq("status", "running")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`[scoring] could not record failed attempt ${attemptId}: ${error.message}`);
  if (!data?.id) throw new Error(`[scoring] failed attempt ${attemptId} was not in running state`);
}

/**
 * Persist one score through the database transaction boundary. The RPC locks the transaction, reconciles
 * anomalies, updates the outcome, and marks the attempt succeeded in one commit. Repeating the same attempt
 * after a lost response is idempotent: a succeeded attempt returns without reapplying the writes.
 */
export async function persistScoringOutcome(
  admin: SupabaseClient,
  input: {
    attempt: ScoringAttempt;
    orgId: string;
    txnId: string;
    vehicleId: string | null;
    fueledAt: string;
    caseFired: RuleResult[];
    outcome: Record<string, unknown>;
  },
): Promise<{ idempotent: boolean; anomalyId: string | null }> {
  const { data, error } = await admin.rpc("persist_scoring_outcome_v2", {
    p_attempt_id: input.attempt.id,
    p_org_id: input.orgId,
    p_transaction_id: input.txnId,
    p_vehicle_id: input.vehicleId,
    p_fueled_at: input.fueledAt,
    p_engine_version: input.attempt.engineVersion,
    p_result_hash: input.attempt.resultHash,
    p_case: casePayload(input.caseFired),
    p_outcome: input.outcome,
    p_recon_checked_at: input.outcome.samsara_recon_checked_at ?? null,
    p_recon_status: input.outcome.samsara_recon_status ?? null,
    p_recon_error: input.outcome.samsara_recon_error ?? null,
    p_recon_evidence_version: input.outcome.samsara_recon_evidence_version ?? 1,
  });
  if (error) throw new Error(`[scoring] atomic persistence failed for ${input.txnId}: ${error.message}`);
  const result = (data ?? {}) as { idempotent?: boolean; anomaly_id?: string | null };
  return { idempotent: result.idempotent === true, anomalyId: result.anomaly_id ?? null };
}

/** Learn per-vehicle values after the atomic score commit. */
export async function learnAndUpdateVehicle(
  admin: SupabaseClient,
  txn: TxnView,
  vehicle: VehicleView,
  samsaraVehicleId: string | null,
  odometerOffsetSource: string,
  recentTxns: TxnView[],
  opts: ScoreOpts,
): Promise<void> {
  if (!txn.vehicleId) return;
  const vehUpdate: Record<string, unknown> = {};
  // vehicles.current_odometer:
  //  - Samsara-linked truck → the periodic sync owns it (OBD reading, authoritative). Never
  //    overwrite it with a driver-entered value.
  //  - Unlinked truck → LATEST entered odometer, not MAX.
  if (!samsaraVehicleId) {
    const { data: lastRow, error } = await admin
      .from("fuel_transactions")
      .select("odometer")
      .eq("vehicle_id", txn.vehicleId)
      .not("odometer", "is", null)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`[scoring] could not load latest odometer for ${txn.vehicleId}: ${error.message}`);
    if (lastRow?.odometer != null) vehUpdate.current_odometer = lastRow.odometer;
  }

  if (vehicle.baselineMpg == null) {
    const base = effectiveBaseline(vehicle, recentTxns);
    if (base != null) vehUpdate.baseline_mpg = base;
  }

  if (Object.keys(vehUpdate).length) {
    const { error } = await admin.from("vehicles").update(vehUpdate).eq("id", txn.vehicleId);
    if (error) throw new Error(`[scoring] could not update vehicle ${txn.vehicleId}: ${error.message}`);
  }

  if (!opts.skipLearn) {
    await learnVehicleValues(admin, txn.vehicleId, {
      odometerOffset: vehicle.odometerOffset ?? 0,
      odometerOffsetSource,
    });
  }
}

export { casePayload };
