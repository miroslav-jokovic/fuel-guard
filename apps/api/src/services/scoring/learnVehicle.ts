/** Per-vehicle learned values that GATE the rules (split from scoreTransaction.ts — file-size budget). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { learnOdometerOffset, learnTankSensorReliability, learnObservedMaxFill, learnSensorCapacity, decideCapacityAutoFix } from "@fuelguard/shared";
import { writeAudit } from "../../lib/audit.js";
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
      // WP-BEH: THIS truck's measured sensor noise — sizes the precision-scaled tank_fill_short
      // tolerance (3σ clamped 8–30%) and the chronic-short threshold.
      vehUpdate.tank_residual_sigma = rel.ratioSigma;
    }
  }

  // The vehicle row is read ONCE for the capacity learners below (nameplate ceiling + the auto-fix
  // decision + the audit context).
  const { data: veh } = await admin.from("vehicles").select("org_id, tank_capacity_gal, tank_capacity_source, observed_max_fill_gal").eq("id", vehicleId).single();
  const enteredCapacityGal = veh ? Number(veh.tank_capacity_gal) : undefined;

  // Observed (combined) capacity FIRST — corroborated high single-fill volume. Besides raising the
  // effective capacity, it is the PHYSICAL FLOOR the sensor measurement must respect (a fill can't
  // exceed the tank), so it must be current before the sensor learner's auto-fix decision below.
  // Passes the entered nameplate so non-physical fills (typos/pump errors) are discarded before learning,
  // and the corroboration floor means a lone outlier can never train capacity up (audit A2.1).
  let observedMaxFillGal: number | null = veh?.observed_max_fill_gal != null ? Number(veh.observed_max_fill_gal) : null;
  {
    const { data: fillRows } = await admin
      .from("fuel_transactions")
      .select("gallons")
      .eq("vehicle_id", vehicleId)
      .eq("tank_type", "tractor")
      .gt("gallons", 0)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // deterministic sample at the limit boundary (audit A2.5)
      .limit(30);
    const gallons = ((fillRows ?? []) as { gallons: number | string }[]).map((r) => Number(r.gallons)).reverse();
    const learnedCap = learnObservedMaxFill(gallons, { nameplateGal: enteredCapacityGal });
    if (learnedCap) {
      vehUpdate.observed_max_fill_gal = learnedCap.gallons;
      observedMaxFillGal = learnedCap.gallons;
    }
  }

  // Sensor-MEASURED capacity (WP-CAP) — physics: billed gallons ÷ raw level-rise per fill, robust median.
  // Uses the RAW percentages (samsara_fuel_pct_before/_after), never samsara_tank_observed_gal (that value
  // is derived FROM the entered capacity — learning from it would be circular). Cannot be trained by billed
  // gallons alone (stolen fuel produces no rise), and can correct an over-entered capacity DOWNWARD.
  {
    const { data: capRows } = await admin
      .from("fuel_transactions")
      .select("gallons, samsara_fuel_pct_before, samsara_fuel_pct_after")
      .eq("vehicle_id", vehicleId)
      .eq("tank_type", "tractor")
      .not("samsara_fuel_pct_before", "is", null)
      .not("samsara_fuel_pct_after", "is", null)
      .gt("gallons", 0)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // deterministic sample at the limit boundary (audit A2.5)
      .limit(30);
    const obs = ((capRows ?? []) as { gallons: number | string; samsara_fuel_pct_before: number | string; samsara_fuel_pct_after: number | string }[])
      .map((p) => ({ gallons: Number(p.gallons), pctBefore: Number(p.samsara_fuel_pct_before), pctAfter: Number(p.samsara_fuel_pct_after) }))
      .reverse();
    const cap = learnSensorCapacity(obs);
    if (cap) {
      vehUpdate.sensor_capacity_gal = cap.gallons;
      vehUpdate.sensor_capacity_samples = cap.samples;

      // WP-CAP part 2 — SELF-HEALING RECORD: when the measurement is rock-solid (≥8 clustered
      // observations) and the entered capacity is missing or >15% off it, rewrite tank_capacity_gal to
      // the measured value. Stamped 'auto' + audit-logged so every correction is visible; the resolver
      // then reads entered ≈ sensor → HIGH confidence → tight alert tolerance, and the divergence item
      // clears from Coverage/digest on its own.
      const fix = decideCapacityAutoFix({ enteredGal: enteredCapacityGal ?? null, sensorGal: cap.gallons, sensorSamples: cap.samples, observedMaxFillGal });
      if (fix) {
        vehUpdate.tank_capacity_gal = fix.gallons;
        vehUpdate.tank_capacity_source = "auto";
        if (veh?.org_id) {
          await writeAudit(admin, {
            orgId: veh.org_id as string,
            action: "vehicle.capacity_autofix",
            entity: "vehicle",
            entityId: vehicleId,
            meta: {
              beforeGal: enteredCapacityGal ?? null,
              afterGal: fix.gallons,
              sensorSamples: cap.samples,
              reason: fix.reason,
              previousSource: (veh?.tank_capacity_source as string | null) ?? null,
            },
          });
        }
      }
    }
  }

  if (Object.keys(vehUpdate).length) {
    await admin.from("vehicles").update(vehUpdate).eq("id", vehicleId);
  }
}
