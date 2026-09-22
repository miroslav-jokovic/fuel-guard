/** Per-vehicle learned values that GATE the rules (split from scoreTransaction.ts — file-size budget). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { learnOdometerOffset, learnTankSensorReliability, learnObservedMaxFill, learnSensorCapacity, decideCapacityAutoFix } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { n } from "./loaders.js";

/**
 * DIFF-BEFORE-WRITE, the idiom `samsaraStatsFeed.ts` already uses for the live feed and for the same
 * reason — its comment records 862k vehicle updates "most of them writing identical values".
 *
 * WHY THIS FUNCTION EXISTS (measured 2026-09-22, TELEMETRY-SEPARATION-PLAN Q-TEL4). The learner
 * recomputes from the last 30 fills on every scoring run and used to commit whatever it produced,
 * gated on `Object.keys(vehUpdate).length` — "was a value computed", never "did it change". Over a
 * 12-minute production window that issued **375 tuple writes while an md5 of all 272 vehicles' six
 * learned columns did not move at all**, and the family is 48.8% of this table's 4.8M writes
 * (`pg_stat_statements`), against ~200 fills a day that could move a learned value.
 *
 * A no-op UPDATE costs exactly what a real one costs: a new tuple, `set_updated_at()`, the audit
 * trigger's 91-column comparison, and 0262's mirror into both satellites.
 *
 * ⚠ THE COMPARISON GOES THROUGH `n()`, AND THAT IS THE WHOLE GATE. PostgREST returns `numeric` as a
 * STRING — `odometer_offset` comes back as `"10.0"`, `tank_fill_ratio` as `"0.991"` — so a strict
 * `===` against the learner's number is false for every column on every run, and the gate would
 * silently be no gate at all while looking like one. Every learner already rounds to its column's
 * scale (`learnOdometerOffset` → integer, `learnTankSensorReliability` → 3 dp,
 * `learnSensorCapacity` → 1 dp, all verified 2026-09-22), so once both sides are numbers an exact
 * comparison is right and no scale table is needed here — one would only restate the schema.
 */
function setIfChanged(
  patch: Record<string, unknown>,
  current: Record<string, unknown> | null | undefined,
  column: string,
  value: number | boolean,
): void {
  const cur = current?.[column];
  const unchanged = typeof value === "boolean" ? cur === value : cur != null && n(cur) === value;
  if (!unchanged) patch[column] = value;
}

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

  // The vehicle row is read ONCE — for the nameplate ceiling, the auto-fix decision, the audit context,
  // AND (Q-TEL4) as the diff basis every learner below compares against before it writes. It moved above
  // the learners to serve that fourth job; the read itself is the same single read it always was.
  const { data: vehRow } = await admin
    .from("vehicles")
    .select(
      "org_id, tank_capacity_gal, tank_capacity_source, observed_max_fill_gal, tank_sensor_reliable, tank_fill_ratio, tank_residual_sigma, sensor_capacity_gal, sensor_capacity_samples",
    )
    .eq("id", vehicleId)
    .single();
  const veh = (vehRow ?? null) as Record<string, unknown> | null;
  const enteredCapacityGal = veh ? Number(veh.tank_capacity_gal) : undefined;

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
    if (learned) {
      setIfChanged(vehUpdate, { odometer_offset: odometerOffset }, "odometer_offset", learned.offset);
      if (vehUpdate.odometer_offset !== undefined) vehUpdate.odometer_offset_source = "auto";
    }
  }

  // Tank-sensor reliability (observed-rise ÷ billed ≈ 1) — gates the per-fill tank/volume/MPG rules.
  {
    const { data: tankRows } = await admin
      .from("fuel_transactions")
      .select("samsara_tank_observed_gal, gallons, fueling_time_basis, attribution_verdict")
      .eq("vehicle_id", vehicleId)
      .eq("tank_type", "tractor")
      .eq("fueling_time_basis", "tank_confirmed")
      .not("samsara_tank_observed_gal", "is", null)
      .gt("gallons", 0)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(12);
    const tankPairs = ((tankRows ?? []) as {
      samsara_tank_observed_gal: number | string;
      gallons: number | string;
      fueling_time_basis: string | null;
      attribution_verdict: string | null;
    }[])
      .filter((p) => p.fueling_time_basis === "tank_confirmed" && p.attribution_verdict !== "suspect")
      .map((p) => ({ observedRiseGal: Number(p.samsara_tank_observed_gal), billedGallons: Number(p.gallons) }))
      .reverse();
    const rel = learnTankSensorReliability(tankPairs);
    if (rel) {
      setIfChanged(vehUpdate, veh, "tank_sensor_reliable", rel.reliable);
      setIfChanged(vehUpdate, veh, "tank_fill_ratio", rel.ratio);
      // WP-BEH: THIS truck's measured sensor noise — sizes the precision-scaled tank_fill_short
      // tolerance (3σ clamped 8–30%) and the chronic-short threshold.
      setIfChanged(vehUpdate, veh, "tank_residual_sigma", rel.ratioSigma);
    }
  }

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
      setIfChanged(vehUpdate, veh, "observed_max_fill_gal", learnedCap.gallons);
      // The downstream auto-fix decision needs the value regardless of whether it is being WRITTEN —
      // unchanged still means current.
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
      .select("gallons, samsara_fuel_pct_before, samsara_fuel_pct_after, fueling_time_basis, attribution_verdict")
      .eq("vehicle_id", vehicleId)
      .eq("tank_type", "tractor")
      .eq("fueling_time_basis", "tank_confirmed")
      .not("samsara_fuel_pct_before", "is", null)
      .not("samsara_fuel_pct_after", "is", null)
      .gt("gallons", 0)
      .order("fueled_at", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }) // deterministic sample at the limit boundary (audit A2.5)
      .limit(30);
    const obs = ((capRows ?? []) as {
      gallons: number | string;
      samsara_fuel_pct_before: number | string;
      samsara_fuel_pct_after: number | string;
      fueling_time_basis: string | null;
      attribution_verdict: string | null;
    }[])
      .filter((p) => p.fueling_time_basis === "tank_confirmed" && p.attribution_verdict !== "suspect")
      .map((p) => ({ gallons: Number(p.gallons), pctBefore: Number(p.samsara_fuel_pct_before), pctAfter: Number(p.samsara_fuel_pct_after) }))
      .reverse();
    const cap = learnSensorCapacity(obs);
    if (cap) {
      setIfChanged(vehUpdate, veh, "sensor_capacity_gal", cap.gallons);
      setIfChanged(vehUpdate, veh, "sensor_capacity_samples", cap.samples);

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
    // CHECKED, like every other write in this subsystem (audit 2026-08-09, finding E). This is the
    // only place the learned per-truck state — odometer offset, tank-sensor reliability + sigma,
    // observed/sensor capacity, an auto-corrected nameplate — is committed, and a capacity auto-fix
    // has ALREADY been audit-logged by the time we get here. Swallowing the error left an audit entry
    // claiming a correction that never landed, and every later fill re-derived the same learned values
    // from scratch and silently failed to persist them again.
    const { error } = await admin.from("vehicles").update(vehUpdate).eq("id", vehicleId);
    if (error) throw new Error(`[scoring] could not update learned state for vehicle ${vehicleId}: ${error.message}`);
  }
}
