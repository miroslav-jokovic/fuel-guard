/** scoreTransaction context loaders (P2-B split): each reads the DB and returns the derived inputs one
 *  stage of the rule context needs, leaving scoreTransaction a lean orchestrator. Behavior is identical to
 *  the inlined blocks — same queries, same ordering, same defaults when a stage doesn't apply. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contaminatesBaseline,
  robustWindowMiles,
  type TxnView,
  type VehicleView,
  type Thresholds,
} from "@fuelguard/shared";
import { FTXN_COLS, ODOMETER_RULE_IDS, toTxnView, sumIntermediateGallons, n } from "./loaders.js";
import type { FtxnRow } from "./loaders.js";

export interface VehicleContext {
  vehicle: VehicleView;
  samsaraVehicleId: string | null;
  odometerOffsetSource: string;
}

/** Resolve the fill's vehicle into a VehicleView (+ its Samsara id + odometer-offset source). Defaults to
 *  the "none" vehicle when the fill has no vehicle_id or the row is missing. */
export async function loadVehicleContext(
  admin: SupabaseClient,
  vehicleId: string | null,
): Promise<VehicleContext> {
  let vehicle: VehicleView = {
    id: "none",
    fuelType: "other",
    tankCapacityGal: 0,
    baselineMpg: null,
  };
  let samsaraVehicleId: string | null = null;
  let odometerOffsetSource = "auto";
  if (vehicleId) {
    const { data: v } = await admin
      .from("vehicles")
      .select(
        "id, fuel_type, tank_capacity_gal, tank_sensor_reliable, observed_max_fill_gal, sensor_capacity_gal, sensor_capacity_samples, baseline_mpg, samsara_vehicle_id, odometer_offset, odometer_offset_source",
      )
      .eq("id", vehicleId)
      .single();
    if (v) {
      vehicle = {
        id: v.id,
        fuelType: v.fuel_type,
        tankCapacityGal: Number(v.tank_capacity_gal),
        tankSensorReliable: v.tank_sensor_reliable === true,
        observedMaxFillGal: n(v.observed_max_fill_gal) ?? undefined,
        sensorCapacityGal: n(v.sensor_capacity_gal) ?? undefined,
        sensorCapacitySamples: n(v.sensor_capacity_samples) ?? undefined,
        baselineMpg: n(v.baseline_mpg),
        odometerOffset: n(v.odometer_offset) ?? 0,
      };
      samsaraVehicleId = v.samsara_vehicle_id ?? null;
      odometerOffsetSource = (v.odometer_offset_source as string) ?? "auto";
    }
  }
  return { vehicle, samsaraVehicleId, odometerOffsetSource };
}

export interface ConsumptionContext {
  previousTxn: TxnView | null;
  recentTxns: TxnView[];
  intermediateGallons: number;
  windowGallons: number;
  windowMiles: number | null;
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
    const odoBad = (x: FtxnRow) =>
      badIds.has(x.id) || (x.case_signals ?? []).some((sg) => ODO_SIGNALS.has(sg.ruleId));
    const prevRow = rows.find((x) => !odoBad(x)) ?? null;
    previousTxn = prevRow ? toTxnView(prevRow) : null;
    // WP6: theft-contaminated fills (volume-axis evidence / alert cases) must not train the baseline —
    // sustained theft would drag the median down until its own deviations stop firing.
    recentTxns = rows
      .filter((x) => !odoBad(x) && !contaminatesBaseline(x.case_level, x.case_signals))
      .slice(0, 6)
      .map(toTxnView)
      .reverse();
    if (prevRow)
      intermediateGallons = await sumIntermediateGallons(
        admin,
        txn.vehicleId,
        prevRow.fueled_at,
        r.fueled_at,
        txnId,
      ); // WP4

    const { data: winRows } = await admin
      .from("fuel_transactions")
      .select("gallons, odometer, samsara_odometer, samsara_odometer_source")
      .eq("vehicle_id", txn.vehicleId)
      .eq("tank_type", "tractor")
      .gte("fueled_at", winStartIso)
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
      wr.map((x) => ({
        enteredOdometer: n(x.odometer),
        samsaraOdometer: n(x.samsara_odometer),
        samsaraSource: x.samsara_odometer_source,
      })),
    ).miles;
  }

  return { previousTxn, recentTxns, intermediateGallons, windowGallons, windowMiles };
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
    reeferTankCapacityGal =
      reeferTrailers.length === 1 ? Number(reeferTrailers[0]!.reefer_tank_capacity_gal) : null;
    const { data: rwin } = await admin
      .from("fuel_transactions")
      .select("gallons")
      .eq("org_id", orgId)
      .eq("vehicle_id", txn.vehicleId)
      .eq("tank_type", "reefer")
      .gte("fueled_at", winStartIso)
      .lte("fueled_at", r.fueled_at);
    reeferWindowGallons = ((rwin ?? []) as { gallons: number | string }[]).reduce(
      (s, x) => s + Number(x.gallons),
      0,
    );
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
  return {
    reeferPaired,
    orgUsesReeferFuel,
    reeferDiversionReeferGal,
    reeferDiversionTractorGal,
    reeferLoadInWindow,
  };
}
