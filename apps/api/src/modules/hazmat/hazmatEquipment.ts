import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveVehicleKind, type VehicleKindResolution } from "@silvicom/shared";

/**
 * What kind of equipment is this hazmat load actually on (F-P2), and what tank does it carry (H-C2).
 *
 * Every analysis path used to hard-code `cargo_tank`; F-P2 made the kind a read of the trailer's
 * type. H-C2 then folded the cargo-tank data itself — capacity and compartments — onto the
 * `trailers` and `vehicles` rows (D-H3) and dropped the separate `hazmat_cargo_tank_profiles`
 * table, so this is now the single read for BOTH facts: one query fetches the type and the tank
 * columns together, and the callers stopped making their own profile queries.
 *
 * The decision itself lives in `resolveVehicleKind` (shared, so the dashboard and the engine cannot
 * disagree). A load with no trailer and no vehicle still resolves — `confident: false` — and since TC1.4 (Q-TC4 (a))
 * every analysis path WITHHOLDS on it (`HAZMAT_EQUIPMENT_UNKNOWN_FLAG`); the info advisory that used to ride beside a
 * tank verdict is gone.
 */
export interface CargoTankData {
  cargo_capacity_gal: number | null;
  compartments: Array<{ index: number; capacityGal: number }> | null;
}

export interface EquipmentContext extends VehicleKindResolution {
  trailerId: string | null;
  trailerType: string | null;
  /** The equipment row's cargo-tank data (H-C2); null when none is on file. */
  tank: CargoTankData | null;
}

interface EquipmentRow {
  trailer_type?: string | null;
  cargo_capacity_gal: number | null;
  cargo_compartments: Array<{ index: number; capacityGal: number }> | null;
}

export async function readEquipmentKind(
  admin: SupabaseClient,
  orgId: string,
  load: { trailer_id: string | null; vehicle_id: string | null },
): Promise<EquipmentContext> {
  let trailerType: string | null = null;
  let row: EquipmentRow | null = null;
  if (load.trailer_id) {
    const { data } = await admin
      .from("trailers")
      .select("trailer_type, cargo_capacity_gal, cargo_compartments")
      .eq("org_id", orgId)
      .eq("id", load.trailer_id)
      .maybeSingle();
    row = (data as EquipmentRow | null) ?? null;
    trailerType = row?.trailer_type ?? null;
  } else if (load.vehicle_id) {
    // Straight trucks / bobtails: the vehicle row carries the cargo columns; it has no trailer_type.
    const { data } = await admin
      .from("vehicles")
      .select("cargo_capacity_gal, cargo_compartments")
      .eq("org_id", orgId)
      .eq("id", load.vehicle_id)
      .maybeSingle();
    row = (data as EquipmentRow | null) ?? null;
  }
  const compartments = row?.cargo_compartments ?? null;
  const hasTankData = row != null && (row.cargo_capacity_gal != null || (compartments?.length ?? 0) > 0);
  const tank: CargoTankData | null = hasTankData
    ? { cargo_capacity_gal: row!.cargo_capacity_gal, compartments: compartments && compartments.length > 0 ? compartments : null }
    : null;
  return {
    ...resolveVehicleKind({ trailerType, hasCargoTankProfile: hasTankData }),
    trailerId: load.trailer_id,
    trailerType,
    tank,
  };
}
