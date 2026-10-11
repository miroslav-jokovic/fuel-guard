import type { SupabaseClient } from "@supabase/supabase-js";
import {
  IN_SERVICE_VEHICLE_STATUSES,
  LONG_PARK,
  behavesLike,
  declaredEquipment,
  longParkShares,
  needsEquipmentReview,
  purchaseBatchKey,
  type IdleEquipmentRow,
} from "@silvicom/shared";
import { fetchAllPaged } from "../../lib/paging.js";

/**
 * Every in-service truck's declared idle equipment beside its long-park behaviour
 * (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md IE1, D-IE7) — the Idling page's equipment tab.
 *
 * ── WHY THE SERVER, NOT THE BROWSER ─────────────────────────────────────────────────────────────
 * The behaviour comes from `vehicle_long_park_behaviour` (0403), which only the service role may
 * call, and is aggregated in SQL because 45 days of parks is ~8,000 rows against PostgREST's 1,000
 * cap. The verdict — what the counts mean — is `@silvicom/shared`'s, so the thresholds have one home.
 * The tab used to read `vehicles` straight from the browser and compare the 0043 learned capability
 * instead; that read is replaced, not kept beside this one.
 */

interface VehicleEquipmentRow {
  id: string;
  unit_number: string;
  make: string | null;
  model: string | null;
  year: number | null;
  purchased_at: string | null;
  has_apu: boolean | null;
  apu_type: string | null;
  has_optimized_idle: boolean | null;
  equipment_source: string | null;
  idle_capability: string | null;
  idle_optimized_pct: number | string | null;
}

interface BehaviourRow {
  vehicle_id: string;
  parks: number;
  idling_parks: number;
  off_parks: number;
}

export async function readIdleEquipment(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<IdleEquipmentRow[]> {
  const from = new Date(now.getTime() - LONG_PARK.windowDays * 86_400_000);
  const [vehicles, behaviour] = await Promise.all([
    fetchAllPaged<VehicleEquipmentRow>((a, b) =>
      admin
        .from("vehicles")
        .select(
          "id, unit_number, make, model, year, purchased_at, has_apu, apu_type, has_optimized_idle, equipment_source, idle_capability, idle_optimized_pct",
        )
        .eq("org_id", orgId)
        .in("status", [...IN_SERVICE_VEHICLE_STATUSES])
        .order("id")
        .range(a, b),
    ),
    admin.rpc("vehicle_long_park_behaviour", {
      p_org: orgId,
      p_from: from.toISOString(),
      p_to: now.toISOString(),
      p_min_park_sec: LONG_PARK.minParkSec,
      p_idling_share: LONG_PARK.idlingShare,
      p_off_share: LONG_PARK.offShare,
    }),
  ]);
  if (behaviour.error) throw new Error(`idle equipment: long-park behaviour failed: ${behaviour.error.message}`);
  const byVehicle = new Map(((behaviour.data ?? []) as BehaviourRow[]).map((b) => [b.vehicle_id, b]));

  return vehicles.map((v) => {
    const b = byVehicle.get(v.id);
    const measure = { parks: b?.parks ?? 0, idlingParks: b?.idling_parks ?? 0, offParks: b?.off_parks ?? 0 };
    const declared = declaredEquipment({ hasApu: v.has_apu, apuType: v.apu_type });
    const behaves = behavesLike(measure);
    return {
      vehicleId: v.id,
      unitNumber: v.unit_number,
      batch: purchaseBatchKey({ make: v.make, model: v.model, year: v.year, purchasedAt: v.purchased_at }),
      hasApu: v.has_apu,
      apuType: v.apu_type,
      hasOptimizedIdle: v.has_optimized_idle,
      equipmentSource: v.equipment_source,
      declared,
      parks: measure.parks,
      ...longParkShares(measure),
      behavesLike: behaves,
      review: needsEquipmentReview(declared, behaves),
      idleCapability: v.idle_capability,
      idleOptimizedPct: v.idle_optimized_pct == null ? 0 : Number(v.idle_optimized_pct),
    };
  });
}
