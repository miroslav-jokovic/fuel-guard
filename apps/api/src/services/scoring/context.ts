/** scoreTransaction context loaders (P2-B split): each reads the DB and returns the derived inputs one
 *  stage of the rule context needs, leaving scoreTransaction a lean orchestrator. Behavior is identical to
 *  the inlined blocks — same queries, same ordering, same defaults when a stage doesn't apply. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contaminatesBaseline, robustWindowMiles, verifyFillAttribution, isDriverOffDutyAtFill, ATTRIBUTION_TIME_BUFFER_MS,
  type TxnView, type VehicleView, type Thresholds, type AttributionCheck, type LogbookSegment,
} from "@fuelguard/shared";
import { writeAudit } from "../../lib/audit.js";
import { FTXN_COLS, ODOMETER_RULE_IDS, toTxnView, sumIntermediateGallons, n } from "./loaders.js";
import type { FtxnRow } from "./loaders.js";

export interface VehicleContext {
  vehicle: VehicleView;
  samsaraVehicleId: string | null;
  odometerOffsetSource: string;
}

/** Resolve the fill's vehicle into a VehicleView (+ its Samsara id + odometer-offset source). Defaults to
 *  the "none" vehicle when the fill has no vehicle_id or the row is missing. */
export async function loadVehicleContext(admin: SupabaseClient, vehicleId: string | null): Promise<VehicleContext> {
  let vehicle: VehicleView = { id: "none", fuelType: "other", tankCapacityGal: 0, baselineMpg: null };
  let samsaraVehicleId: string | null = null;
  let odometerOffsetSource = "auto";
  if (vehicleId) {
    const { data: v } = await admin.from("vehicles").select("id, fuel_type, tank_capacity_gal, tank_sensor_reliable, tank_residual_sigma, observed_max_fill_gal, sensor_capacity_gal, sensor_capacity_samples, baseline_mpg, samsara_vehicle_id, odometer_offset, odometer_offset_source").eq("id", vehicleId).single();
    if (v) {
      vehicle = { id: v.id, fuelType: v.fuel_type, tankCapacityGal: Number(v.tank_capacity_gal), tankSensorReliable: v.tank_sensor_reliable === true, tankRatioSigma: n(v.tank_residual_sigma) ?? undefined, observedMaxFillGal: n(v.observed_max_fill_gal) ?? undefined, sensorCapacityGal: n(v.sensor_capacity_gal) ?? undefined, sensorCapacitySamples: n(v.sensor_capacity_samples) ?? undefined, baselineMpg: n(v.baseline_mpg), odometerOffset: n(v.odometer_offset) ?? 0 };
      samsaraVehicleId = v.samsara_vehicle_id ?? null;
      odometerOffsetSource = (v.odometer_offset_source as string) ?? "auto";
    }
  }
  return { vehicle, samsaraVehicleId, odometerOffsetSource };
}

/**
 * WP-ATTR — check the fill's vehicle attribution against the driver's ELD logbook timeline
 * (hos_duty_segments with per-log vehicle, migration 0120). Returns `unknown` — behavior unchanged —
 * whenever the check can't be made honestly: no driver on the fill, no reliable fueling INSTANT (a
 * date-only EFS row's noon sentinel would compare the logbook at the wrong time of day), or no
 * in-buffer logbook coverage with a resolved vehicle.
 */
export interface AttributionContext {
  check: AttributionCheck;
  /** WP-BEH — the fill sits deep inside an extended ELD off-duty/sleeper block of the assigned driver. */
  driverOffDutyAtFill: boolean;
}

/** Fetch the driver's logbook segments overlapping the fill's ±buffer window (with status + vehicle). */
async function loadDriverLogbookSegments(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  fillMs: number,
): Promise<LogbookSegment[]> {
  const loIso = new Date(fillMs - ATTRIBUTION_TIME_BUFFER_MS).toISOString();
  const hiIso = new Date(fillMs + ATTRIBUTION_TIME_BUFFER_MS).toISOString();
  const { data } = await admin
    .from("hos_duty_segments")
    .select("vehicle_id, status, started_at, ended_at")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .lte("started_at", hiIso)
    .or(`ended_at.is.null,ended_at.gte.${loIso}`)
    .order("started_at", { ascending: true })
    .limit(50);
  return ((data ?? []) as { vehicle_id: string | null; status: string | null; started_at: string; ended_at: string | null }[]).map((s) => ({
    vehicleId: s.vehicle_id,
    status: s.status,
    startMs: Date.parse(s.started_at),
    endMs: s.ended_at != null ? Date.parse(s.ended_at) : null,
  }));
}

export async function loadAttributionCheck(
  admin: SupabaseClient,
  orgId: string,
  txn: TxnView,
): Promise<AttributionContext> {
  const empty: AttributionContext = { check: { verdict: "unknown", logbookVehicleId: null }, driverOffDutyAtFill: false };
  if (!txn.driverId || !txn.vehicleId || txn.tankType === "reefer") return empty;
  // The fueling INSTANT must be trustworthy — same timeReliable bar every time-based rule uses
  // (production finding, 2026-08): an UNCORROBORATED EFS posted time counts as "instant" precision but
  // can be an authorization/settlement timestamp hours off the real pump time (plus timezone-basis
  // slop), which landed honest daytime fills "deep inside" drivers' sleeper blocks and false-fired
  // fuel_while_driver_home. Only a telematics-corroborated or manual instant may be compared to the
  // logbook; uncorroborated → unknown (unchanged behavior).
  if (txn.fueledAtPrecision !== "instant" || txn.timeConfirmed === false) return empty;
  const fillMs = Date.parse(txn.eventAt ?? txn.fueledAt); // telematics-recovered instant when present
  const segments = await loadDriverLogbookSegments(admin, orgId, txn.driverId, fillMs);
  return {
    check: verifyFillAttribution(txn.vehicleId, fillMs, segments),
    driverOffDutyAtFill: isDriverOffDutyAtFill(segments, fillMs),
  };
}

/**
 * WP-BEH — SELF-HEAL for unattributed fills: fill the BLANK side of the attribution from the logbook
 * when it is unambiguous. Never overwrites an existing value (that path is the verify/re-attribute flow):
 *  - vehicle missing, driver known → the driver's UNIQUE logbook truck covering the instant. Returns
 *    "vehicle_filled" so the caller re-scores under the vehicle (all vehicle-relative context changes).
 *  - driver missing, vehicle known → the UNIQUE driver whose logbook shows this truck at the instant;
 *    applied in place (txn mutated) — driver-scoped context loads after this, so no re-score needed.
 * Ambiguity (two candidates: team drivers, slip-seat) → no action, honestly unattributed. Audit-logged.
 */
export async function healMissingAttribution(
  admin: SupabaseClient,
  orgId: string,
  txnId: string,
  txn: TxnView,
): Promise<"vehicle_filled" | null> {
  // Same trustworthy-instant bar as loadAttributionCheck — a settlement-time lookup against the
  // logbook could heal a blank with the WRONG truck/driver.
  if (txn.tankType === "reefer" || txn.fueledAtPrecision !== "instant" || txn.timeConfirmed === false) return null;
  const fillMs = Date.parse(txn.eventAt ?? txn.fueledAt);

  if (txn.vehicleId == null && txn.driverId != null) {
    const segments = await loadDriverLogbookSegments(admin, orgId, txn.driverId, fillMs);
    const covering = [...new Set(segments.filter((s) => s.vehicleId != null && s.startMs <= fillMs && (s.endMs ?? Number.POSITIVE_INFINITY) >= fillMs).map((s) => s.vehicleId))];
    if (covering.length === 1) {
      const vehicleId = covering[0]!;
      await writeAudit(admin, {
        orgId,
        action: "transaction.attribute_from_logbook",
        entity: "fuel_transaction",
        entityId: txnId,
        meta: { kind: "vehicle", vehicleId, driverId: txn.driverId, fueledAt: txn.fueledAt },
      });
      await admin.from("fuel_transactions").update({ vehicle_id: vehicleId }).eq("id", txnId);
      return "vehicle_filled";
    }
    return null;
  }

  if (txn.driverId == null && txn.vehicleId != null) {
    const { data } = await admin
      .from("hos_duty_segments")
      .select("driver_id, started_at, ended_at")
      .eq("org_id", orgId)
      .eq("vehicle_id", txn.vehicleId)
      .not("driver_id", "is", null)
      .lte("started_at", new Date(fillMs).toISOString())
      .or(`ended_at.is.null,ended_at.gte.${new Date(fillMs).toISOString()}`)
      .limit(10);
    const drivers = [...new Set(((data ?? []) as { driver_id: string }[]).map((s) => s.driver_id))];
    if (drivers.length === 1) {
      const driverId = drivers[0]!;
      await writeAudit(admin, {
        orgId,
        action: "transaction.attribute_from_logbook",
        entity: "fuel_transaction",
        entityId: txnId,
        meta: { kind: "driver", driverId, vehicleId: txn.vehicleId, fueledAt: txn.fueledAt },
      });
      await admin.from("fuel_transactions").update({ driver_id: driverId }).eq("id", txnId);
      txn.driverId = driverId; // applied in place — driver-scoped context loads AFTER this
    }
    return null;
  }
  return null;
}

export interface ConsumptionContext {
  previousTxn: TxnView | null;
  recentTxns: TxnView[];
  intermediateGallons: number;
  windowGallons: number;
  windowMiles: number | null;
  /** WP-ATTR — gallons excluded from the window because their fills' attribution is logbook-contradicted. */
  windowSuspectGallons: number;
}

/** Tractor consumption context: the previous clean fill, the recent-fills baseline window, intermediate
 *  gallons, and the rolling-window gallons/miles. TRACTOR fills only — reefer (ULSR) gallons must never
 *  enter a tractor's consumption math, so a reefer fill returns the empty defaults. */
export async function loadConsumptionContext(
  admin: SupabaseClient,
  txn: TxnView,
  r: FtxnRow,
  txnId: string,
  winStartIso: string,
): Promise<ConsumptionContext> {
  let previousTxn: TxnView | null = null;
  let recentTxns: TxnView[] = [];
  let intermediateGallons = 0;
  let windowGallons = 0;
  let windowMiles: number | null = null;
  let windowSuspectGallons = 0;

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
    // WP-ATTR: a fill whose attribution the driver's logbook contradicts carries another truck's
    // gallons/odometer — it must not serve as the previous fill or train the baseline.
    const attrBad = (x: FtxnRow) => x.attribution_verdict === "suspect";
    const prevRow = rows.find((x) => !odoBad(x) && !attrBad(x)) ?? null;
    previousTxn = prevRow ? toTxnView(prevRow) : null;
    // WP6: theft-contaminated fills (volume-axis evidence / alert cases) must not train the baseline —
    // sustained theft would drag the median down until its own deviations stop firing.
    recentTxns = rows.filter((x) => !odoBad(x) && !attrBad(x) && !contaminatesBaseline(x.case_level, x.case_signals)).slice(0, 6).map(toTxnView).reverse();
    if (prevRow) intermediateGallons = await sumIntermediateGallons(admin, txn.vehicleId, prevRow.fueled_at, r.fueled_at, txnId); // WP4

    const { data: winRows } = await admin
      .from("fuel_transactions")
      .select("id, gallons, odometer, samsara_odometer, samsara_odometer_source, attribution_verdict")
      .eq("vehicle_id", txn.vehicleId)
      .eq("tank_type", "tractor")
      .gte("fueled_at", winStartIso)
      .lte("fueled_at", r.fueled_at)
      // OLDEST→NEWEST for robustWindowMiles' regression check; created_at,id tiebreakers make the order
      // deterministic when date-only rows share the noon-sentinel fueled_at (R-2 — rebuild idempotency).
      .order("fueled_at", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    const wrAll = (winRows ?? []) as {
      id: string;
      gallons: number | string;
      odometer: number | string | null;
      samsara_odometer: number | string | null;
      samsara_odometer_source: string | null;
      attribution_verdict: string | null;
    }[];
    // WP-ATTR: logbook-contradicted fills are another truck's fuel — excluding them from the window is
    // exactly the driver-changed-truck false-alert fix. The CURRENT fill always stays in (its own
    // verdict gates the rule separately via attributionSuspect); the excluded gallons are reported so
    // evidence can show what was left out.
    const wr = wrAll.filter((x) => x.id === txnId || x.attribution_verdict !== "suspect");
    windowSuspectGallons = wrAll.filter((x) => x.id !== txnId && x.attribution_verdict === "suspect").reduce((s, x) => s + Number(x.gallons), 0);
    windowGallons = wr.reduce((s, x) => s + Number(x.gallons), 0);
    // Miles driven from the CLEAN OBD Samsara odometer span when available; fall back to the entered span only
    // when it doesn't regress; else null → cumulative_overfuel stays silent (data-quality, not a false alarm).
    windowMiles = robustWindowMiles(
      wr.map((x) => ({ enteredOdometer: n(x.odometer), samsaraOdometer: n(x.samsara_odometer), samsaraSource: x.samsara_odometer_source })),
    ).miles;
  }

  return { previousTxn, recentTxns, intermediateGallons, windowGallons, windowMiles, windowSuspectGallons };
}

/**
 * WP-BEH — chronic-short accumulator inputs: the trailing measured fills (rise recorded by Samsara)
 * ending at this fill, with the summed signed shortfall (billed − observed) and total billed gallons.
 * Suspect-attribution fills are excluded (another truck's fuel would poison the residual sum).
 */
export async function loadTankResidualWindow(
  admin: SupabaseClient,
  txn: TxnView,
  r: FtxnRow,
): Promise<{ fills: number; sumShortGal: number; totalBilledGal: number } | null> {
  if (!txn.vehicleId || txn.tankType === "reefer") return null;
  const { data } = await admin
    .from("fuel_transactions")
    .select("gallons, samsara_tank_observed_gal, attribution_verdict")
    .eq("vehicle_id", txn.vehicleId)
    .eq("tank_type", "tractor")
    .not("samsara_tank_observed_gal", "is", null)
    .gt("gallons", 0)
    .lte("fueled_at", r.fueled_at)
    .order("fueled_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // deterministic sample at the limit boundary (audit A2.5)
    .limit(10);
  const rows = ((data ?? []) as { gallons: number | string; samsara_tank_observed_gal: number | string; attribution_verdict: string | null }[])
    .filter((x) => x.attribution_verdict !== "suspect");
  if (rows.length === 0) return null;
  let sumShortGal = 0;
  let totalBilledGal = 0;
  for (const x of rows) {
    const billed = Number(x.gallons);
    const observed = Number(x.samsara_tank_observed_gal);
    if (!Number.isFinite(billed) || !Number.isFinite(observed)) continue;
    sumShortGal += billed - observed; // SIGNED — over-reads cancel shorts, noise sums to ~0
    totalBilledGal += billed;
  }
  return { fills: rows.length, sumShortGal: Math.round(sumShortGal * 10) / 10, totalBilledGal: Math.round(totalBilledGal * 10) / 10 };
}

export interface ReeferContext {
  reeferTankCapacityGal: number | null;
  reeferWindowGallons: number;
}

/** Reefer (ULSR) fills: the paired trailer's reefer tank capacity (only when the pairing is unambiguous)
 *  and this truck's rolling-window reefer gallons — inputs to the Tier A reefer rules. */
export async function loadReeferContext(
  admin: SupabaseClient,
  orgId: string,
  txn: TxnView,
  r: FtxnRow,
  winStartIso: string,
): Promise<ReeferContext> {
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
      .gte("fueled_at", winStartIso)
      .lte("fueled_at", r.fueled_at);
    reeferWindowGallons = ((rwin ?? []) as { gallons: number | string }[]).reduce((s, x) => s + Number(x.gallons), 0);
  }
  return { reeferTankCapacityGal, reeferWindowGallons };
}

export interface ReeferDiversionContext {
  reeferPaired: boolean;
  orgUsesReeferFuel: boolean;
  reeferDiversionReeferGal: number;
  reeferDiversionTractorGal: number;
  reeferLoadInWindow: boolean | undefined;
}

/** Reefer-diversion context (TRACTOR/ULSD fills only) — gated on pairing first so the common truck pays
 *  one cheap existence query. Includes the org-uses-reefer-fuel guard and the opt-in McLeod/TMS
 *  reefer-load gate. */
export async function loadReeferDiversionContext(
  admin: SupabaseClient,
  orgId: string,
  txn: TxnView,
  r: FtxnRow,
  thresholds: Thresholds,
): Promise<ReeferDiversionContext> {
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
  return { reeferPaired, orgUsesReeferFuel, reeferDiversionReeferGal, reeferDiversionTractorGal, reeferLoadInWindow };
}
