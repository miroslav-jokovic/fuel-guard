import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HazmatCargoTankProfileCreateRequest,
  HazmatCargoTankProfileUpdateRequest,
} from "@fuelguard/shared";
import type { ServiceError } from "./hazmatLoads.js";

/**
 * Cargo-tank profile service (plan H5). Capacity + compartment plan per truck/trailer — the producer for
 * the engine `vehicle` block (H2: capacity → 4-sided ID display; compartments → per-compartment math).
 * The analysis orchestrator reads at most ONE profile per equipment (`maybeSingle`), and the 0092 table
 * has no unique constraint, so this service enforces one-profile-per-equipment at write time.
 */
const err = (code: string, error: string): ServiceError => ({ error, code });

const PROFILE_COLUMNS =
  "id, org_id, vehicle_id, trailer_id, cargo_capacity_gal, compartments, created_at, updated_at";

export async function listProfiles(admin: SupabaseClient, orgId: string): Promise<{ rows: unknown[] } | ServiceError> {
  const { data, error } = await admin
    .from("hazmat_cargo_tank_profiles").select(PROFILE_COLUMNS)
    .eq("org_id", orgId).order("created_at", { ascending: false });
  if (error) return err("query_failed", error.message);
  return { rows: (data ?? []) as unknown[] };
}

export async function createProfile(
  admin: SupabaseClient, orgId: string, req: HazmatCargoTankProfileCreateRequest,
): Promise<{ id: string } | ServiceError> {
  // One profile per equipment (the orchestrator reads a single row; the table has no unique index).
  const col = req.vehicleId ? "vehicle_id" : "trailer_id";
  const val = req.vehicleId ?? req.trailerId!;
  const { data: existing } = await admin
    .from("hazmat_cargo_tank_profiles").select("id").eq("org_id", orgId).eq(col, val).maybeSingle();
  if (existing) return err("profile_exists", "A cargo-tank profile already exists for this equipment — edit it instead.");

  const { error } = await admin.from("hazmat_cargo_tank_profiles").insert({
    id: req.id, org_id: orgId,
    vehicle_id: req.vehicleId, trailer_id: req.trailerId,
    cargo_capacity_gal: req.cargoCapacityGal, compartments: req.compartments,
  });
  if (error) return err("insert_failed", error.message);
  return { id: req.id };
}

export async function updateProfile(
  admin: SupabaseClient, orgId: string, profileId: string, req: HazmatCargoTankProfileUpdateRequest,
): Promise<{ ok: true } | ServiceError> {
  const { data: existing } = await admin
    .from("hazmat_cargo_tank_profiles").select("id").eq("org_id", orgId).eq("id", profileId).maybeSingle();
  if (!existing) return err("not_found", "Cargo-tank profile not found.");
  const { error } = await admin
    .from("hazmat_cargo_tank_profiles")
    .update({ cargo_capacity_gal: req.cargoCapacityGal, compartments: req.compartments })
    .eq("org_id", orgId).eq("id", profileId);
  if (error) return err("update_failed", error.message);
  return { ok: true };
}

export async function deleteProfile(
  admin: SupabaseClient, orgId: string, profileId: string,
): Promise<{ ok: true } | ServiceError> {
  const { error } = await admin
    .from("hazmat_cargo_tank_profiles").delete().eq("org_id", orgId).eq("id", profileId);
  if (error) return err("delete_failed", error.message);
  return { ok: true };
}
