import type {
  HazmatCargoTankProfileCreateRequest,
  HazmatCargoTankProfileRow,
  HazmatCargoTankProfileUpdateRequest,
  HazmatCompartment,
} from "@fuelguard/shared";

/**
 * Cargo-tank profile form model + pure form→request logic (plan H5). Import-light (no supabase) so it
 * unit-tests headless. Equipment is encoded as "vehicle:<id>" / "trailer:<id>" for a single picker;
 * exactly one binding is sent (mirrors the 0092 check constraint). Compartments are re-indexed 1..N.
 */
export interface CompartmentForm {
  capacityGal: string;
}
export interface ProfileForm {
  /** "vehicle:<uuid>" | "trailer:<uuid>" | "" — the equipment this profile describes. */
  equipment: string;
  cargoCapacityGal: string;
  compartments: CompartmentForm[];
}

export function emptyProfileForm(): ProfileForm {
  return { equipment: "", cargoCapacityGal: "", compartments: [] };
}

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Decode the equipment token into a vehicle/trailer binding, or null if unset/invalid. */
export function parseEquipment(token: string): { vehicleId: string | null; trailerId: string | null } | null {
  const [kind, id] = token.split(":");
  if (!id) return null;
  if (kind === "vehicle") return { vehicleId: id, trailerId: null };
  if (kind === "trailer") return { vehicleId: null, trailerId: id };
  return null;
}

/** The equipment token for an existing profile row (for the edit form / label lookup). */
export function equipmentToken(row: HazmatCargoTankProfileRow): string {
  return row.vehicle_id ? `vehicle:${row.vehicle_id}` : row.trailer_id ? `trailer:${row.trailer_id}` : "";
}

/** Valid compartments only, re-indexed 1..N (rows with a blank/invalid capacity are dropped). */
export function buildCompartments(rows: CompartmentForm[]): HazmatCompartment[] {
  const out: HazmatCompartment[] = [];
  for (const r of rows) {
    const cap = numOrNull(r.capacityGal);
    if (cap === null || cap < 0) continue;
    out.push({ index: out.length + 1, capacityGal: cap });
  }
  return out;
}

export function profileFormValid(form: ProfileForm): boolean {
  return parseEquipment(form.equipment) !== null;
}

export function buildCreateProfileRequest(id: string, form: ProfileForm): HazmatCargoTankProfileCreateRequest {
  const eq = parseEquipment(form.equipment);
  const body = {
    id,
    vehicleId: eq?.vehicleId ?? null,
    trailerId: eq?.trailerId ?? null,
    cargoCapacityGal: numOrNull(form.cargoCapacityGal),
    compartments: buildCompartments(form.compartments),
  };
  return body as unknown as HazmatCargoTankProfileCreateRequest;
}

export function buildUpdateProfileRequest(form: ProfileForm): HazmatCargoTankProfileUpdateRequest {
  return {
    cargoCapacityGal: numOrNull(form.cargoCapacityGal),
    compartments: buildCompartments(form.compartments),
  };
}

/** Populate the form from an existing row (edit mode). */
export function profileRowToForm(row: HazmatCargoTankProfileRow): ProfileForm {
  return {
    equipment: equipmentToken(row),
    cargoCapacityGal: row.cargo_capacity_gal === null ? "" : String(row.cargo_capacity_gal),
    compartments: (row.compartments ?? []).map((c) => ({ capacityGal: String(c.capacityGal) })),
  };
}
