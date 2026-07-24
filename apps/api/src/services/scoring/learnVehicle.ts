/** Per-vehicle learned values that GATE the rules (split from scoreTransaction.ts — file-size budget). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { learnOdometerOffset, learnTankSensorReliability, learnObservedMaxFill } from "@fuelguard/shared";
import { n } from "./loaders.js";

/**
 * Learn the per-vehicle values that GATE the rules — odometer offset, tank-sensor reliability, and observed
 * (combined) capacity — from the vehicle's own reconciled history, and persist them. Extracted so a bulk
 * rebuild can run it ONCE per vehicle BEFORE scoring, converging the values in a single pass (fixes the
 * two-pass "rebuild twice" limitation, audit R-3). `ctx` passes the caller's already-loaded offset to avoid a
 * re-fetch; omitted on the pre-pass, where we read it from the vehicle row.
 */
export async function learnVehicleValues(
  admin: SupabaseClient,
  vehicleId: string,
  ctx?: { odometerOffset: number; odometerOffsetSource: string },
): Promise<void> {
  let odometerOffset: number;
  let odometerOffsetSource: string;
  if (ctx) {
    odometerOffset = ctx.odometerOffset;
    odometerOffsetSource = ctx.odometerOffsetSource;
  } else {
    const { data: v } = await admin.from("vehicles").select("odometer_offset, odometer_offset_source").eq("id", vehicleId).single();
    if (!v) return;
    odometerOffset = n(v.odometer_offset) ?? 0;
    odometerOffsetSource = (v.odometer_offset_source as string) ?? "auto";
  }
  const vehUpdate: Record<string, unknown> = {};

  // Odometer offset (dash − Samsara), OBD-only, median over the last 10 clustered pairs. Manual is never
  // overwritten.
  if (odometerOffsetSource !== "manual") {
    const { data: pairRows } = await admin
      .from("fuel_transactions")
      .select("odometer, samsara_odometer")
      .eq("vehicle_id", vehicleId)
      .eq("samsara_odometer_source", "obd")
      .not("odometer", "is", null)
      .not("samsara_odometer", "is", null)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // deterministic sample at the limit boundary (audit A2.5)
      .limit(10);
    const pairs = ((pairRows ?? []) as { odometer: number | string; samsara_odometer: number | string }[])
      .map((p) => ({ entered: Number(p.odometer), samsara: Number(p.samsara_odometer) }))
      .reverse();
    const learned = learnOdometerOffset(pairs);
    if (learned && learned.offset !== odometerOffset) {
      vehUpdate.odometer_offset = learned.offset;
      vehUpdate.odometer_offset_source = "auto";
    }
  }

  // Tank-sensor reliability (observed-rise ÷ billed ≈ 1) — gates the per-fill tank/volume/MPG rules.
  {
    const { data: tankRows } = await admin
      .from("fuel_transactions")
      .select("samsara_tank_observed_gal, gallons")
      .eq("vehicle_id", vehicleId)
      .not("samsara_tank_observed_gal", "is", null)
      .gt("gallons", 0)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12);
    const tankPairs = ((tankRows ?? []) as { samsara_tank_observed_gal: number | string; gallons: number | string }[])
      .map((p) => ({ observedRiseGal: Number(p.samsara_tank_observed_gal), billedGallons: Number(p.gallons) }))
      .reverse();
    const rel = learnTankSensorReliability(tankPairs);
    if (rel) {
      vehUpdate.tank_sensor_reliable = rel.reliable;
      vehUpdate.tank_fill_ratio = rel.ratio;
    }
  }

  // Observed (combined) capacity — corroborated high single-fill volume; only raises the effective capacity.
  // Passes the entered nameplate so non-physical fills (typos/pump errors) are discarded before learning, and
  // the corroboration floor means a lone outlier can never train capacity up (audit A2.1). The created_at,id
  // tiebreaker makes the sampled fills deterministic across rebuilds (date-only EFS rows share fueled_at).
  {
    const { data: veh } = await admin.from("vehicles").select("tank_capacity_gal").eq("id", vehicleId).single();
    const nameplateGal = veh ? Number(veh.tank_capacity_gal) : undefined;
    const { data: fillRows } = await admin
      .from("fuel_transactions")
      .select("gallons")
      .eq("vehicle_id", vehicleId)
      .eq("tank_type", "tractor")
      .gt("gallons", 0)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(30);
    const gallons = ((fillRows ?? []) as { gallons: number | string }[]).map((r) => Number(r.gallons)).reverse();
    const learnedCap = learnObservedMaxFill(gallons, { nameplateGal });
    if (learnedCap) vehUpdate.observed_max_fill_gal = learnedCap.gallons;
  }

  if (Object.keys(vehUpdate).length) {
    await admin.from("vehicles").update(vehUpdate).eq("id", vehicleId);
  }
}

