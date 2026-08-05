/** scoreTransaction persistence (P2-B split): the write side — anomaly reconcile/insert/supersede, the
 *  transaction-outcome update, and per-vehicle learning. Extracted verbatim from scoreTransaction so the
 *  orchestrator reads as a sequence of named steps; queries + ordering are unchanged. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  reconcileAnomalies,
  correlateSignals,
  CASE_RULE_ID,
  milesSinceLast,
  computedMpg,
  effectiveBaseline,
  computeFillConfidence,
  summarizeFillGates,
  type RuleContext,
  type TxnView,
  type VehicleView,
  type ExistingAnomaly,
  type RuleResult,
  type AttributionCheck,
} from "@fuelguard/shared";
import type { ReconResult } from "./reconcile.js";
import { learnVehicleValues } from "./learnVehicle.js";
import type { ScoreOpts } from "./loaders.js";

type Assessment = ReturnType<typeof correlateSignals>;

/** Reconcile the fired case against existing anomaly rows: insert new, supersede stale, and refresh an
 *  already-open case in place when its signals changed — but never disturb one a reviewer has moved on. */
export async function persistAnomalies(
  admin: SupabaseClient,
  orgId: string,
  txnId: string,
  vehicleId: string | null,
  fueledAt: string,
  caseFired: RuleResult[],
): Promise<void> {
  const { data: existing } = await admin
    .from("anomalies")
    .select("id, rule_id, status, source")
    .eq("transaction_id", txnId);
  const { toInsert, toSupersedeIds } = reconcileAnomalies(
    (existing ?? []) as ExistingAnomaly[],
    caseFired,
  );

  for (const res of toInsert) {
    const { error } = await admin.from("anomalies").insert({
      org_id: orgId,
      transaction_id: txnId,
      vehicle_id: vehicleId,
      rule_id: res.ruleId,
      severity: res.severity,
      status: "open",
      message: res.message,
      evidence: res.evidence,
      source: "rules",
      // Denormalized for queue filtering — the STORED business time, consistent with the fuel log.
      fueled_at: fueledAt,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  if (toSupersedeIds.length) {
    await admin.from("anomalies").update({ status: "superseded" }).in("id", toSupersedeIds);
  }

  // Refresh an already-open case in place when the signals changed (rebuild/re-score) — but never
  // disturb one a reviewer has moved to investigating/resolved/dismissed.
  if (caseFired.length) {
    const openCase = (existing ?? []).find(
      (a) => a.rule_id === CASE_RULE_ID && a.status === "open",
    );
    if (openCase && !toInsert.length) {
      const c = caseFired[0]!;
      await admin
        .from("anomalies")
        .update({
          severity: c.severity,
          message: c.message,
          evidence: c.evidence,
          fueled_at: fueledAt,
        })
        .eq("id", openCase.id);
    }
  }
}

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

/** Persist the per-fill outcome onto fuel_transactions: MPG/miles chain, the case summary, the fill-gates
 *  "why" surface, and every reconciled Samsara column (odometer, location, tank, observed-position, basis,
 *  recon instant). The telematics-recovered instant is stored in samsara_recon_at — never over fueled_at. */
export async function persistTxnOutcome(
  admin: SupabaseClient,
  txnId: string,
  a: TxnOutcomeArgs,
): Promise<void> {
  const { txn, previousTxn, intermediateGallons, assessment, ruleCtx, recon, attribution } = a;
  await admin
    .from("fuel_transactions")
    .update({
      miles_since_last: milesSinceLast(txn, previousTxn),
      computed_mpg: computedMpg(txn, previousTxn, intermediateGallons),
      has_anomaly: assessment.level !== "clear",
      max_severity: assessment.severity,
      // WP2 "why" surface: persist the outcome even when clear, so sub-threshold signals stay visible.
      case_level: assessment.level,
      case_score: assessment.score,
      case_signals: assessment.signals,
      // WP6: WHY detection was limited on this fill (ineligible rules + the gating inputs) — the UI's
      // honest-absence surface ("tank rules off: sensor not learned-reliable").
      case_gates: summarizeFillGates(computeFillConfidence(ruleCtx)),
      // WP-ATTR: the logbook attribution verdict (+ the contradicting logbook truck when suspect) — the
      // honest-absence surface for "why were the volume rules quiet on this fill".
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
      // Where the truck actually was + how the fueling instant was determined (tank-rise event) — the
      // audit-tab inputs, exact for every reconciled fill.
      samsara_observed_state: recon.observedState,
      samsara_observed_city: recon.observedCity,
      samsara_observed_address: recon.observedAddress,
      samsara_observed_lat: recon.observedLat,
      samsara_observed_lng: recon.observedLng,
      fueling_time_basis: recon.fuelingTimeBasis,
      // The telematics-recovered instant is stored HERE — never written over fueled_at. fueled_at
      // stays the EFS business time so dashboards, dedupe keys and the MPG chain remain stable.
      samsara_recon_at: recon.reconAt,
    })
    .eq("id", txnId);
}

/** Learn per-vehicle values: current_odometer (unlinked trucks only — Samsara owns it otherwise), an
 *  auto-derived baseline MPG when unset, and the gating learned values (offset / tank reliability). */
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
  //  - Unlinked truck → LATEST entered odometer, not MAX: one fat-fingered 9,999,999 under MAX
  //    poisoned the value forever; "latest" self-heals on the next correct entry.
  if (!samsaraVehicleId) {
    const { data: lastRow } = await admin
      .from("fuel_transactions")
      .select("odometer")
      .eq("vehicle_id", txn.vehicleId)
      .not("odometer", "is", null)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // deterministic pick when fueled_at+created_at tie (audit A2.5)
      .limit(1)
      .maybeSingle();
    if (lastRow?.odometer != null) vehUpdate.current_odometer = lastRow.odometer;
  }

  // Auto-derive baseline MPG from the vehicle's own fuel history when it isn't set (Samsara has no
  // MPG). effectiveBaseline returns the median of recent computed MPG once there are ≥3 valid fills.
  if (vehicle.baselineMpg == null) {
    const base = effectiveBaseline(vehicle, recentTxns);
    if (base != null) vehUpdate.baseline_mpg = base;
  }

  if (Object.keys(vehUpdate).length) {
    await admin.from("vehicles").update(vehUpdate).eq("id", txn.vehicleId);
  }

  // Learned values that GATE rules (offset / tank reliability / capacity). A bulk rebuild learns these ONCE
  // up front (backfillOrg pre-pass, skipLearn=true) so every fill scores against the CONVERGED values in a
  // single pass; live/single scoring learns them here per fill.
  if (!opts.skipLearn) {
    await learnVehicleValues(admin, txn.vehicleId, {
      odometerOffset: vehicle.odometerOffset ?? 0,
      odometerOffsetSource,
    });
  }
}
