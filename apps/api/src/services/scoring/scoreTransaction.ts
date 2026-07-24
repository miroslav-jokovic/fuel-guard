/** Score one transaction + learn per-vehicle values — core pass (grandfathered: large by design). */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runAllRules, reconcileAnomalies, correlateSignals, CASE_RULE_ID, milesSinceLast, computedMpg,
  effectiveBaseline, robustWindowMiles, contaminatesBaseline, computeFillConfidence, summarizeFillGates,
  type RuleContext, type TxnView, type VehicleView,
  type ExistingAnomaly, type RuleResult, type RuleId,
} from "@fuelguard/shared";
import type { Env } from "../../env.js";
import { resolveReconciliation } from "./reconcile.js";
import { resolveCardContext } from "./cardContext.js";
import { learnVehicleValues } from "./learnVehicle.js";

export { learnVehicleValues } from "./learnVehicle.js"; // re-export: barrel + backfill import path unchanged
import { deriveDriverHomeAtFill } from "./tmsGates.js";
import { FTXN_COLS, ODOMETER_RULE_IDS, toTxnView, loadThresholds, loadOperatingHours, sumIntermediateGallons, n } from "./loaders.js";
import type { FtxnRow, ScoreOpts } from "./loaders.js";

export async function scoreTransaction(
  admin: SupabaseClient,
  env: Env,
  orgId: string,
  txnId: string,
  opts: ScoreOpts = {},
): Promise<void> {
  const { data: row } = await admin.from("fuel_transactions").select(FTXN_COLS).eq("id", txnId).eq("org_id", orgId).single();
  if (!row) return;
  const r = row as FtxnRow;
  const txn = toTxnView(r);

  let vehicle: VehicleView = { id: "none", fuelType: "other", tankCapacityGal: 0, baselineMpg: null };
  let samsaraVehicleId: string | null = null;
  let odometerOffsetSource = "auto";
  if (txn.vehicleId) {
    const { data: v } = await admin.from("vehicles").select("id, fuel_type, tank_capacity_gal, tank_sensor_reliable, observed_max_fill_gal, baseline_mpg, samsara_vehicle_id, odometer_offset, odometer_offset_source").eq("id", txn.vehicleId).single();
    if (v) {
      vehicle = { id: v.id, fuelType: v.fuel_type, tankCapacityGal: Number(v.tank_capacity_gal), tankSensorReliable: v.tank_sensor_reliable === true, observedMaxFillGal: n(v.observed_max_fill_gal) ?? undefined, baselineMpg: n(v.baseline_mpg), odometerOffset: n(v.odometer_offset) ?? 0 };
      samsaraVehicleId = v.samsara_vehicle_id ?? null;
      odometerOffsetSource = (v.odometer_offset_source as string) ?? "auto";
    }
  }

  const thresholds = opts.ctx?.thresholds ?? (await loadThresholds(admin, orgId));
  const operatingHours = opts.ctx?.operatingHours ?? (await loadOperatingHours(admin, orgId));
  const windowMs = (thresholds.cumulativeWindowHours ?? 48) * 3_600_000;
  // Rolling windows anchor on the STORED fueled_at (business time) — never the recovered instant.
  const storedTime = new Date(r.fueled_at).getTime();
  const winStart = () => new Date(storedTime - windowMs).toISOString();

  // ── Samsara reconciliation: the fueling-time odometer truth + recovered fueling time + location check.
  // Extracted to ./reconcile.ts; it also applies the telematics-recovered instant to `txn` in memory. ──
  const {
    crossSourceOdometer,
    crossSourceOdometerAt,
    crossSourceOdometerSource,
    samsaraLocationMatched,
    locationConfidence,
    stationLat,
    stationLng,
    nearestStationMiles,
    locationEvidence,
    reconAt,
    tankFillShortGal,
    tankObservedRiseGal,
    tankPctBefore,
    tankPctAfter,
    observedState,
    observedCity,
    observedAddress,
    observedLat,
    observedLng,
    fuelingTimeBasis,
  } = await resolveReconciliation(admin, env, orgId, r, txn, vehicle, samsaraVehicleId, opts);

  let previousTxn: TxnView | null = null;
  let recentTxns: TxnView[] = [];
  let intermediateGallons = 0;
  let windowGallons = 0;
  let windowMiles: number | null = null;

  // TRACTOR fills only — reefer (ULSR) gallons must never enter a tractor's consumption math.
  if (txn.vehicleId && txn.tankType !== "reefer") {
    const { data: prevRows } = await admin
      .from("fuel_transactions")
      .select(FTXN_COLS)
      .eq("vehicle_id", txn.vehicleId)
      .eq("tank_type", "tractor")
      .lt("fueled_at", r.fueled_at)
      .not("odometer", "is", null)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12);
    const rows = (prevRows ?? []) as FtxnRow[];

    const candidateIds = rows.map((x) => x.id);
    let badIds = new Set<string>();
    if (candidateIds.length) {
      const { data: anoms } = await admin
        .from("anomalies")
        .select("transaction_id, rule_id, status")
        .in("transaction_id", candidateIds)
        .neq("status", "superseded")
        .in("rule_id", ODOMETER_RULE_IDS);
      badIds = new Set((anoms ?? []).map((a) => a.transaction_id as string));
    }
    // Previous fill = the most recent fill whose odometer is NOT already flagged as anomalous (legacy
    // anomalies rows OR persisted case_signals). Comparing against a known-bad reading cascaded false
    // regressions / MPG anomalies onto every correct entry after it.
    const ODO_SIGNALS = new Set(ODOMETER_RULE_IDS);
    const odoBad = (x: FtxnRow) => badIds.has(x.id) || (x.case_signals ?? []).some((sg) => ODO_SIGNALS.has(sg.ruleId));
    const prevRow = rows.find((x) => !odoBad(x)) ?? null;
    previousTxn = prevRow ? toTxnView(prevRow) : null;
    // WP6: theft-contaminated fills (volume-axis evidence / alert cases) must not train the baseline —
    // sustained theft would drag the median down until its own deviations stop firing.
    recentTxns = rows.filter((x) => !odoBad(x) && !contaminatesBaseline(x.case_level, x.case_signals)).slice(0, 6).map(toTxnView).reverse();
    if (prevRow) intermediateGallons = await sumIntermediateGallons(admin, txn.vehicleId, prevRow.fueled_at, r.fueled_at, txnId); // WP4


    const { data: winRows } = await admin
      .from("fuel_transactions")
      .select("gallons, odometer, samsara_odometer, samsara_odometer_source")
      .eq("vehicle_id", txn.vehicleId)
      .eq("tank_type", "tractor")
      .gte("fueled_at", winStart())
      .lte("fueled_at", r.fueled_at)
      // OLDEST→NEWEST for robustWindowMiles' regression check; created_at,id tiebreakers make the order
      // deterministic when date-only rows share the noon-sentinel fueled_at (R-2 — rebuild idempotency).
      .order("fueled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    const wr = (winRows ?? []) as {
      gallons: number | string;
      odometer: number | string | null;
      samsara_odometer: number | string | null;
      samsara_odometer_source: string | null;
    }[];
    windowGallons = wr.reduce((s, x) => s + Number(x.gallons), 0);
    // Miles driven from the CLEAN OBD Samsara odometer span when available; fall back to the entered span only
    // when it doesn't regress; else null → cumulative_overfuel stays silent (data-quality, not a false alarm).
    windowMiles = robustWindowMiles(
      wr.map((x) => ({ enteredOdometer: n(x.odometer), samsaraOdometer: n(x.samsara_odometer), samsaraSource: x.samsara_odometer_source })),
    ).miles;
  }

  // Card-identity context (WP3): a true CARD-keyed vehicle count + the fuel_cards assignment — see
  // resolveCardContext for the identity rules (never driver-keyed; unidentifiable cards stay uncounted).
  const cardCtx = await resolveCardContext(admin, orgId, txn, winStart(), r.fueled_at);

  // Reefer (ULSR) fills: resolve the paired trailer's reefer tank capacity (current pairing) and the
  // rolling-window reefer gallons for this truck — inputs to the Tier A reefer rules.
  let reeferTankCapacityGal: number | null = null;
  let reeferWindowGallons = 0;
  if (txn.vehicleId && txn.tankType === "reefer") {
    // Resolve the paired reefer trailer's tank capacity — but ONLY when the pairing is unambiguous.
    // If a truck has 2+ assigned reefer trailers we can't know which one this fill went into, so we
    // leave capacity unknown (null) and the reefer rules stay quiet, rather than judging the fill
    // against an arbitrarily-picked tank (match-don't-guess, like the unit/driver reconciliation).
    const { data: trailerRows } = await admin
      .from("trailers")
      .select("reefer_tank_capacity_gal")
      .eq("org_id", orgId)
      .eq("assigned_vehicle_id", txn.vehicleId)
      .eq("is_reefer", true)
      .neq("status", "retired")
      .limit(2);
    const reeferTrailers = (trailerRows ?? []) as { reefer_tank_capacity_gal: number | string }[];
    reeferTankCapacityGal = reeferTrailers.length === 1 ? Number(reeferTrailers[0]!.reefer_tank_capacity_gal) : null;
    const { data: rwin } = await admin
      .from("fuel_transactions")
      .select("gallons")
      .eq("org_id", orgId)
      .eq("vehicle_id", txn.vehicleId)
      .eq("tank_type", "reefer")
      .gte("fueled_at", winStart())
      .lte("fueled_at", r.fueled_at);
    reeferWindowGallons = ((rwin ?? []) as { gallons: number | string }[]).reduce((s, x) => s + Number(x.gallons), 0);
  }

  // Reefer-diversion (TRACTOR/ULSD fills only) — gated on pairing first so the common truck pays one
  // cheap existence query.
  let reeferPaired = false;
  let orgUsesReeferFuel = false;
  let reeferDiversionReeferGal = 0;
  let reeferDiversionTractorGal = 0;
  let reeferLoadInWindow: boolean | undefined; // McLeod/TMS reefer-load gate; undefined = no feed (unchanged)
  if (txn.vehicleId && txn.tankType !== "reefer") {
    const { data: pairedRows } = await admin
      .from("trailers")
      .select("id")
      .eq("org_id", orgId)
      .eq("assigned_vehicle_id", txn.vehicleId)
      .eq("is_reefer", true)
      .neq("status", "retired")
      .limit(1);
    reeferPaired = ((pairedRows ?? []) as unknown[]).length > 0;
    if (reeferPaired) {
      const days = thresholds.reeferDiversionWindowDays ?? 30;
      const divStart = new Date(Date.parse(r.fueled_at) - days * 86_400_000).toISOString();
      const { data: divRows } = await admin
        .from("fuel_transactions")
        .select("gallons, tank_type")
        .eq("org_id", orgId)
        .eq("vehicle_id", txn.vehicleId)
        .gte("fueled_at", divStart)
        .lte("fueled_at", r.fueled_at);
      for (const x of (divRows ?? []) as { gallons: number | string; tank_type: string | null }[]) {
        const g = Number(x.gallons) || 0;
        if (x.tank_type === "reefer") reeferDiversionReeferGal += g;
        else reeferDiversionTractorGal += g;
      }
      // The fleet must actually code reefer fuel separately: any ULSR purchase org-wide in the window. Without
      // this, a fleet that simply never uses a reefer product code would false-flag every reefer-hauling truck.
      const { data: orgReefer } = await admin
        .from("fuel_transactions")
        .select("id")
        .eq("org_id", orgId)
        .eq("tank_type", "reefer")
        .gte("fueled_at", divStart)
        .lte("fueled_at", r.fueled_at)
        .limit(1);
      orgUsesReeferFuel = ((orgReefer ?? []) as unknown[]).length > 0;

      // McLeod/TMS reefer-load gate (opt-in): only when the org has an ENABLED TMS feed do we consult it. A
      // reefer-paired truck that pulled no temperature-controlled load in the window had no reason to buy
      // reefer fuel, so the rule suppresses the alert. No feed -> reeferLoadInWindow stays undefined and the
      // fuel-only heuristic is unchanged (one tiny indexed lookup is the only cost for non-TMS orgs).
      const { data: tmsOn } = await admin
        .from("org_integrations")
        .select("enabled")
        .eq("org_id", orgId)
        .eq("provider", "mcleod")
        .eq("enabled", true)
        .maybeSingle();
      if (tmsOn) {
        const { data: tempLoads } = await admin
          .from("tms_movements")
          .select("id")
          .eq("org_id", orgId)
          .eq("vehicle_id", txn.vehicleId)
          .eq("temperature_controlled", true)
          .gte("started_at", divStart)
          .lte("started_at", r.fueled_at)
          .limit(1);
        reeferLoadInWindow = ((tempLoads ?? []) as unknown[]).length > 0;
      }
    }
  }

  // McLeod/TMS driver-home gate (opt-in, corroboration-only): if a driver owns this fill, was it made
  // while that driver was on home time / off duty? undefined for non-TMS orgs (fuel-only behavior kept).
  const driverHomeAtFill = txn.driverId
    ? await deriveDriverHomeAtFill(admin, orgId, txn.driverId, r.fueled_at)
    : undefined;

  const ruleCtx: RuleContext = {
    txn,
    vehicle,
    previousTxn,
    recentTxns,
    intermediateGallons,
    thresholds,
    operatingHours,
    crossSourceOdometer,
    crossSourceOdometerSource,
    windowGallons,
    windowMiles,
    cardVehicleCountInWindow: cardCtx.cardVehicleCountInWindow,
    cardAssignedVehicleId: cardCtx.cardAssignedVehicleId,
    cardManualAssignedVehicleId: cardCtx.cardManualAssignedVehicleId,
    samsaraLocationMatched,
    locationEvidence,
    tankFillShortGal,
    tankObservedRiseGal,
    tankPctBefore,
    reeferTankCapacityGal,
    reeferWindowGallons,
    reeferPaired,
    orgUsesReeferFuel,
    reeferDiversionReeferGal,
    reeferDiversionTractorGal,
    reeferLoadInWindow,
    driverHomeAtFill,
    ambientTempF: n(r.ambient_temp_f),
  };
  const fired = runAllRules(ruleCtx);

  // Correlate the fired signals into ONE per-transaction case (multi-signal model). A lone weak signal
  // stays "clear" (no anomaly) so normal fills don't all look flagged; independent corroborating signals
  // (or one physically-impossible one) become a single "theft_case" alert.
  const assessment = correlateSignals(fired);
  const caseFired: RuleResult[] =
    assessment.level === "clear"
      ? []
      : [{ ruleId: CASE_RULE_ID as RuleId, fired: true, severity: assessment.severity!, message: assessment.summary, evidence: { level: assessment.level, score: assessment.score, axes: assessment.axes, signals: assessment.signals } }];

  const { data: existing } = await admin.from("anomalies").select("id, rule_id, status, source").eq("transaction_id", txnId);
  const { toInsert, toSupersedeIds } = reconcileAnomalies((existing ?? []) as ExistingAnomaly[], caseFired);

  for (const res of toInsert) {
    const { error } = await admin.from("anomalies").insert({
      org_id: orgId,
      transaction_id: txnId,
      vehicle_id: txn.vehicleId,
      rule_id: res.ruleId,
      severity: res.severity,
      status: "open",
      message: res.message,
      evidence: res.evidence,
      source: "rules",
      // Denormalized for queue filtering — the STORED business time, consistent with the fuel log.
      fueled_at: r.fueled_at,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
  }
  if (toSupersedeIds.length) {
    await admin.from("anomalies").update({ status: "superseded" }).in("id", toSupersedeIds);
  }

  // Refresh an already-open case in place when the signals changed (rebuild/re-score) — but never
  // disturb one a reviewer has moved to investigating/resolved/dismissed.
  if (caseFired.length) {
    const openCase = (existing ?? []).find((a) => a.rule_id === CASE_RULE_ID && a.status === "open");
    if (openCase && !toInsert.length) {
      const c = caseFired[0]!;
      await admin.from("anomalies").update({ severity: c.severity, message: c.message, evidence: c.evidence, fueled_at: r.fueled_at }).eq("id", openCase.id);
    }
  }

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
      samsara_odometer: crossSourceOdometer,
      samsara_odometer_at: crossSourceOdometerAt,
      samsara_odometer_source: crossSourceOdometerSource,
      samsara_location_matched: samsaraLocationMatched,
      samsara_location_confidence: locationConfidence,
      samsara_nearest_station_miles: nearestStationMiles,
      station_lat: stationLat,
      station_lng: stationLng,
      samsara_tank_short_gal: tankFillShortGal,
      samsara_tank_observed_gal: tankObservedRiseGal,
      samsara_fuel_pct_before: tankPctBefore,
      samsara_fuel_pct_after: tankPctAfter,
      // Where the truck actually was + how the fueling instant was determined (tank-rise event) — the
      // audit-tab inputs, exact for every reconciled fill.
      samsara_observed_state: observedState,
      samsara_observed_city: observedCity,
      samsara_observed_address: observedAddress,
      samsara_observed_lat: observedLat,
      samsara_observed_lng: observedLng,
      fueling_time_basis: fuelingTimeBasis,
      // The telematics-recovered instant is stored HERE — never written over fueled_at. fueled_at
      // stays the EFS business time so dashboards, dedupe keys and the MPG chain remain stable.
      samsara_recon_at: reconAt,
    })
    .eq("id", txnId);

  if (txn.vehicleId) {
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
      await learnVehicleValues(admin, txn.vehicleId, { odometerOffset: vehicle.odometerOffset ?? 0, odometerOffsetSource });
    }
  }
}

/** Score a transaction and re-score the following fills within the baseline window (docs/09 P1.6). */
