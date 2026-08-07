import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveVehicleKind, type VehicleKindResolution } from "@fuelguard/shared";

/**
 * What kind of equipment is this hazmat load actually on (F-P2).
 *
 * Every analysis path used to hard-code `cargo_tank`. The comment at the old call site claimed the
 * cargo-tank profile refined it; the profile only ever supplied capacity and compartments, never the
 * kind. So the trailer a dispatcher picked in the Load Workspace had no effect on the verdict, every
 * scanned bill of lading was analysed as bulk, and — because the qualification gate demands an N or X
 * tank endorsement whenever the kind is `cargo_tank` — every driver on every hazmat load was failed
 * for lacking a tank endorsement whether or not a tank was involved.
 *
 * The decision itself lives in `resolveVehicleKind` (shared, so the dashboard and the engine cannot
 * disagree). This function is only the read: fetch the trailer's type, and tell the resolver whether a
 * cargo-tank profile exists as corroborating evidence.
 *
 * A load with no trailer and no vehicle still resolves — to the conservative answer, flagged as an
 * assumption. Silence was the old behaviour and it is what this replaces.
 */
export interface EquipmentContext extends VehicleKindResolution {
  trailerId: string | null;
  trailerType: string | null;
}

export async function readEquipmentKind(
  admin: SupabaseClient,
  orgId: string,
  load: { trailer_id: string | null; vehicle_id: string | null },
  hasCargoTankProfile: boolean,
): Promise<EquipmentContext> {
  let trailerType: string | null = null;
  if (load.trailer_id) {
    const { data } = await admin
      .from("trailers")
      .select("trailer_type")
      .eq("org_id", orgId)
      .eq("id", load.trailer_id)
      .maybeSingle();
    trailerType = (data as { trailer_type?: string | null } | null)?.trailer_type ?? null;
  }
  return {
    ...resolveVehicleKind({ trailerType, hasCargoTankProfile }),
    trailerId: load.trailer_id,
    trailerType,
  };
}

/**
 * The advisory a load carries when its carrier context was assumed rather than read. Surfaced as an
 * advisory, not a flag: an unset trailer type must not block a load, it must be visible and fixable.
 */
export function equipmentAssumptionAdvisory(equipment: EquipmentContext): Record<string, unknown> | null {
  if (equipment.confident) return null;
  return {
    ruleId: "vehicle_kind_assumed",
    tier: "info",
    message:
      `Carrier context was not read from the equipment — ${equipment.because}. ` +
      "Set the trailer's type on the Trailers page so placarding is decided from what you are actually hauling.",
    citations: [{ cfr: "internal: equipment context (F-P2 / D-H4)" }],
  };
}

/** Existence check only — the profile's capacity and compartments are read separately where needed. */
export async function hasCargoTankProfile(
  admin: SupabaseClient,
  orgId: string,
  load: { trailer_id: string | null; vehicle_id: string | null },
): Promise<boolean> {
  if (!load.trailer_id && !load.vehicle_id) return false;
  const q = admin.from("hazmat_cargo_tank_profiles").select("id").eq("org_id", orgId);
  const { data } = await (load.trailer_id
    ? q.eq("trailer_id", load.trailer_id)
    : q.eq("vehicle_id", load.vehicle_id)
  ).maybeSingle();
  return data != null;
}
