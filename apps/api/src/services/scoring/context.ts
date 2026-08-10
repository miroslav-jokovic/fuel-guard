/** scoreTransaction context loaders (P2-B split): each reads the DB and returns the derived inputs one
 *  stage of the rule context needs, leaving scoreTransaction a lean orchestrator. Behavior is identical to
 *  the inlined blocks — same queries, same ordering, same defaults when a stage doesn't apply. */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  verifyFillAttribution, isDriverOffDutyAtFill, ATTRIBUTION_TIME_BUFFER_MS,
  IDLE_BURN_GPH, eventTime,
  type TxnView, type VehicleView, type Thresholds, type AttributionCheck, type LogbookSegment,
} from "@fuelguard/shared";
import { writeAudit } from "../../lib/audit.js";
import { n, rowEventTime } from "./loaders.js";
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

/** No duty-status segment plausibly spans more than this — the LOWER time bound that turns the logbook
 *  lookups into a tight index-range scan (perf finding, 2026-08: without it, every per-fill query
 *  walked the driver's ENTIRE segment history — 100–226ms avg on a 915k-row table). Multi-day off-duty
 *  home blocks are the longest real segments; 7 days covers them with margin. */
const LOGBOOK_SEGMENT_MAX_SPAN_MS = 7 * 86_400_000;

/** Fetch the driver's logbook segments overlapping the fill's ±buffer window (with status + vehicle). */
async function loadDriverLogbookSegments(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
  fillMs: number,
): Promise<LogbookSegment[]> {
  const loIso = new Date(fillMs - ATTRIBUTION_TIME_BUFFER_MS).toISOString();
  const hiIso = new Date(fillMs + ATTRIBUTION_TIME_BUFFER_MS).toISOString();
  const scanFromIso = new Date(fillMs - LOGBOOK_SEGMENT_MAX_SPAN_MS).toISOString();
  const { data } = await admin
    .from("hos_duty_segments")
    .select("vehicle_id, status, started_at, ended_at")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .gte("started_at", scanFromIso) // tight index range — see LOGBOOK_SEGMENT_MAX_SPAN_MS
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
      // The write is CHECKED, like every other write in this subsystem (audit 2026-08-09, finding E).
      // Ignoring `{ error }` here reported "vehicle_filled" on a rejected update, and the caller then
      // re-scored the fill under a vehicle the row is not attributed to — persisting evidence (baselines,
      // tank context, capacity) that cites a truck the transaction does not belong to. A permission or
      // constraint failure must stop the self-heal, not be laundered into a confident verdict.
      const { error: fillVehicleError } = await admin
        .from("fuel_transactions")
        .update({ vehicle_id: vehicleId })
        .eq("id", txnId);
      if (fillVehicleError) {
        throw new Error(`[scoring] could not attribute vehicle for ${txnId}: ${fillVehicleError.message}`);
      }
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
      .gte("started_at", new Date(fillMs - LOGBOOK_SEGMENT_MAX_SPAN_MS).toISOString()) // tight index range
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
      // Checked before the in-memory state is mutated (audit 2026-08-09, finding E). The old order
      // set `txn.driverId` regardless of the outcome, so a REJECTED driver update still steered the
      // rest of scoring: driver-scoped context loaded for that driver, and the anomaly evidence was
      // persisted naming a driver the transaction is not attributed to — an accusation against someone
      // the database never linked to the fill.
      const { error: fillDriverError } = await admin
        .from("fuel_transactions")
        .update({ driver_id: driverId })
        .eq("id", txnId);
      if (fillDriverError) {
        throw new Error(`[scoring] could not attribute driver for ${txnId}: ${fillDriverError.message}`);
      }
      txn.driverId = driverId; // applied in place — driver-scoped context loads AFTER this
    }
    return null;
  }
  return null;
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
  winEndIso?: string,
): Promise<{ fills: number; sumShortGal: number; totalBilledGal: number; shortFills: number } | null> {
  if (!txn.vehicleId || txn.tankType === "reefer") return null;
  const { data } = await admin
    .from("fuel_transactions")
    .select("gallons, samsara_tank_observed_gal, attribution_verdict, fueling_time_basis, fueled_at, fueled_at_precision, source, samsara_recon_at, samsara_location_matched")
    .eq("vehicle_id", txn.vehicleId)
    .eq("tank_type", "tractor")
    .eq("is_canonical", true)
    .not("samsara_tank_observed_gal", "is", null)
    // 2026-08 hardening: TANK-CONFIRMED measurements only. The fallback pre-fill reading (no detected
    // rise event) is up to 45 min STALE-HIGH — fuel burned on the approach understates every rise by
    // ~4–8 gal, an asymmetric bias the signed-residual sum cannot cancel. It made one driver's routine
    // read as chronic skimming. A rise-event measurement reads the level at the exact fueling instant.
    .eq("fueling_time_basis", "tank_confirmed")
    .gt("gallons", 0)
    .lte("fueled_at", winEndIso ?? r.fueled_at)
    .order("fueled_at", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false }) // deterministic sample at the limit boundary (audit A2.5)
    .limit(10);
  const anchorMs = Date.parse(eventTime(txn));
  const rows = ((data ?? []) as {
    gallons: number | string;
    samsara_tank_observed_gal: number | string;
    attribution_verdict: string | null;
    fueled_at: string;
    fueled_at_precision: string | null;
    source: string;
    fueling_time_basis: string | null;
    samsara_recon_at: string | null;
    samsara_location_matched: boolean | null;
  }[]).filter((x) => {
    const at = Date.parse(rowEventTime(x));
    return x.attribution_verdict !== "suspect" && Number.isFinite(at) && at <= anchorMs;
  });
  if (rows.length === 0) return null;
  let sumShortGal = 0;
  let totalBilledGal = 0;
  let shortFills = 0;
  for (const x of rows) {
    const billed = Number(x.gallons);
    const observed = Number(x.samsara_tank_observed_gal);
    if (!Number.isFinite(billed) || !Number.isFinite(observed)) continue;
    sumShortGal += billed - observed; // SIGNED — over-reads cancel shorts, noise sums to ~0
    totalBilledGal += billed;
    if (billed > observed) shortFills++;
  }
  return { fills: rows.length, sumShortGal: Math.round(sumShortGal * 10) / 10, totalBilledGal: Math.round(totalBilledGal * 10) / 10, shortFills };
}

/**
 * 2026-08 — MEASURED idle-burn allowance for the cumulative window. Sums vehicle_engine_days.idle_sec
 * over the days overlapping [winStart, fill], PRO-RATING edge days by the fraction of the day inside
 * the window (day rows are calendar-day grain in tz_offset_minutes), then converts hours → gallons at
 * IDLE_BURN_GPH. Returns 0 when no engine-time facts exist for the window — the allowance only ever
 * widens the ceiling on MEASUREMENT, never on assumption (precision in the recall direction: a truck
 * with no telematics keeps exactly the old ceiling).
 */
export async function loadWindowIdleGallons(
  admin: SupabaseClient,
  txn: TxnView,
  winStartIso: string,
  winEndIso?: string,
): Promise<number> {
  if (!txn.vehicleId || txn.tankType === "reefer") return 0;
  const winStartMs = Date.parse(winStartIso);
  const winEndMs = Date.parse(winEndIso ?? eventTime(txn));
  if (!Number.isFinite(winStartMs) || !Number.isFinite(winEndMs) || winEndMs <= winStartMs) return 0;
  // Fetch day rows covering the window ± one day of slack for timezone-offset day boundaries.
  const fromDay = new Date(winStartMs - 86_400_000).toISOString().slice(0, 10);
  const toDay = new Date(winEndMs + 86_400_000).toISOString().slice(0, 10);
  const { data } = await admin
    .from("vehicle_engine_days")
    .select("day, idle_sec, tz_offset_minutes")
    .eq("vehicle_id", txn.vehicleId)
    .gte("day", fromDay)
    .lte("day", toDay);
  let idleSec = 0;
  for (const d of (data ?? []) as { day: string; idle_sec: number | string; tz_offset_minutes: number | null }[]) {
    const sec = Number(d.idle_sec) || 0;
    if (sec <= 0) continue;
    const offMs = (Number(d.tz_offset_minutes) || 0) * 60_000;
    const dayStartMs = Date.parse(`${d.day}T00:00:00.000Z`) - offMs; // local-day start in UTC
    const dayEndMs = dayStartMs + 86_400_000;
    const overlapMs = Math.min(dayEndMs, winEndMs) - Math.max(dayStartMs, winStartMs);
    if (overlapMs <= 0) continue;
    idleSec += sec * (overlapMs / 86_400_000); // pro-rate: idle time assumed uniform across the day
  }
  if (idleSec <= 0) return 0;
  return (idleSec / 3600) * IDLE_BURN_GPH;
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
  winStartIso: string,
): Promise<ReeferContext> {
  /**
   * The upper bound is DERIVED here, not accepted from the caller — deliberately.
   *
   * The scoring window is built as `anchor ± cumulativeWindowHours`, i.e. twice the configured span,
   * and this loader used to be handed that far edge while ruleReeferOverfuelRate sized its physical
   * ceiling from `gph * cumulativeWindowHours`. Ninety-six hours of purchases were judged against a
   * forty-eight-hour burn allowance: three honest 45-gal fills over four days summed to 135 gal
   * against a 122-gal ceiling and fired a weight-75 `high` theft alert, with evidence reading
   * "bought 135 gal in 48h" for fuel that spanned four days (audit 2026-08-09, finding 4.1a).
   *
   * Taking the bound as a parameter is what allowed the wrong one to be passed, so the parameter is
   * gone. Clipping to the fill being scored also makes re-scoring deterministic — a fill can no
   * longer flip to an alert because a LATER purchase entered its window.
   */
  const anchorIso = txn.fueledAt;
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
      .lte("fueled_at", anchorIso);
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
  thresholds: Thresholds,
  winEndIso?: string,
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
      const anchorMs = Date.parse(eventTime(txn));
      const divStart = new Date(anchorMs - days * 86_400_000).toISOString();
      const divEnd = winEndIso ?? eventTime(txn);
      const { data: divRows } = await admin
        .from("fuel_transactions")
        .select("gallons, tank_type")
        .eq("org_id", orgId)
        .eq("vehicle_id", txn.vehicleId)
        .gte("fueled_at", divStart)
        .lte("fueled_at", divEnd);
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
        .lte("fueled_at", divEnd)
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
          .lte("started_at", divEnd)
          .limit(1);
        reeferLoadInWindow = ((tempLoads ?? []) as unknown[]).length > 0;
      }
    }
  }
  return { reeferPaired, orgUsesReeferFuel, reeferDiversionReeferGal, reeferDiversionTractorGal, reeferLoadInWindow };
}
