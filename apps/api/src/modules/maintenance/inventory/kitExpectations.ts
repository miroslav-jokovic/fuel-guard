import type { SupabaseClient } from "@supabase/supabase-js";
import type { KitExpectationDto, KitExpectationInput, UnitKind } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * What a unit is expected to hold (INVENTORY-PLAN.md step I7, D-INV12).
 *
 * ── TWO LAYERS, AND HELD-VERSUS-EXPECTED IS NEITHER OF THEM ────────────────────────────────────
 * A fleet default per (asset type, unit kind), and per-unit override rows. What a truck actually
 * holds is `listAssets({ vehicleId })`, and the comparison is `deriveKitStatus` in
 * `@silvicom/shared` — the one function api and web both call (I9). No kit status is stored
 * anywhere, because a stored one goes stale the moment an asset moves, which is the dual-source
 * defect this repo has already paid for once in CDL and medical expiry.
 *
 * ── THE ORDER THE LAYERS RESOLVE IN IS SQL'S, NOT THIS FILE'S ──────────────────────────────────
 * `move_asset` resolves per-unit, then the fleet default for the unit kind, then the type's own
 * `default_kit_quantity`, and `IV020` depends on getting that order right. This service reads and
 * writes the rows; it does not re-implement the resolution, because a second spelling of it would
 * let the kit screen and the refusal disagree about the same truck. `supabase/tests/
 * inventory-assets.test.mjs` pins the order by "a per-unit override of one beats the type's default
 * of two" and "...and the override is that trailer's alone".
 */

const COLUMNS = "id, asset_type_id, unit_kind, vehicle_id, trailer_id, quantity, asset_types(name)";

interface ExpectationRow {
  id: string;
  asset_type_id: string;
  unit_kind: UnitKind;
  vehicle_id: string | null;
  trailer_id: string | null;
  quantity: number;
  asset_types: { name: string } | null;
}

export const toKitExpectationDto = (r: ExpectationRow): KitExpectationDto => ({
  id: r.id,
  assetTypeId: r.asset_type_id,
  assetTypeName: r.asset_types?.name ?? "",
  unitKind: r.unit_kind,
  vehicleId: r.vehicle_id,
  trailerId: r.trailer_id,
  quantity: Number(r.quantity),
});

export interface ListKitExpectationsOptions {
  unitKind?: UnitKind;
  vehicleId?: string;
  trailerId?: string;
  /** The fleet defaults alone — rows naming no unit, which no `.eq()` can ask for. */
  fleetOnly?: boolean;
  limit?: number;
  offset?: number;
}

export async function listKitExpectations(
  admin: SupabaseClient,
  orgId: string,
  opts: ListKitExpectationsOptions = {},
): Promise<{ expectations: KitExpectationDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  let q = admin.from("kit_expectations").select(COLUMNS, { count: "exact" }).eq("org_id", orgId);
  if (opts.unitKind) q = q.eq("unit_kind", opts.unitKind);
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  if (opts.trailerId) q = q.eq("trailer_id", opts.trailerId);
  if (opts.fleetOnly) q = q.is("vehicle_id", null).is("trailer_id", null);

  const { data, error, count } = await q
    .order("unit_kind", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return traced("listKitExpectations", "db_error", "Could not load the kit", error);
  return {
    expectations: ((data ?? []) as unknown as ExpectationRow[]).map(toKitExpectationDto),
    total: count ?? 0,
  };
}

const failure = (error: { code?: string }): ServiceError | null => {
  // 0333's guard: the truck, the trailer or the asset type is not this org's. No foreign key can
  // say so — none of those tables carries an (id, org_id) unique constraint to point one at.
  if (error.code === "IV012") {
    return { error: "That truck, trailer or asset type is not available.", code: "IV012" };
  }
  // 23514: `kit_expectations_kind_matches_unit`. A vehicle override that calls itself a trailer's
  // kit, or the reverse. The schema is the authority on that rule, so the message names the rule.
  if (error.code === "23514") {
    return { error: "A kit rule for a truck cannot be written against a trailer.", code: "malformed_kit" };
  }
  return null;
};

/**
 * Write one expectation.
 *
 * ⚠ Not an `upsert`, even though "set the quantity for this type on this unit" is the shape upserts
 * exist for. `lint:upserts` forbids a partial payload and the reason bites here exactly: the
 * conflict target is one of THREE partial unique indexes — the fleet default, the vehicle override,
 * the trailer override — and PostgREST's `onConflict` names columns, not a partial index, so the
 * one it would arbitrate on depends on which columns happen to be null. An UPDATE that reports how
 * many rows it moved, then an INSERT when it moved none, is the version whose behaviour does not
 * depend on that. Migrations 0174/0175 are the house pattern.
 */
export async function setKitExpectation(
  admin: SupabaseClient,
  orgId: string,
  input: KitExpectationInput,
): Promise<KitExpectationDto | ServiceError> {
  const vehicleId = input.vehicleId ?? null;
  const trailerId = input.trailerId ?? null;

  let existing = admin
    .from("kit_expectations")
    .select("id")
    .eq("org_id", orgId)
    .eq("asset_type_id", input.assetTypeId)
    .eq("unit_kind", input.unitKind);
  existing = vehicleId ? existing.eq("vehicle_id", vehicleId) : existing.is("vehicle_id", null);
  existing = trailerId ? existing.eq("trailer_id", trailerId) : existing.is("trailer_id", null);

  const { data: found, error: findError } = await existing.maybeSingle();
  if (findError) return traced("setKitExpectation", "db_error", "Could not read the kit rule", findError);

  if (found) {
    const { data, error } = await admin
      .from("kit_expectations")
      .update({ quantity: input.quantity, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", (found as { id: string }).id)
      .select(COLUMNS)
      .single();
    if (error) {
      const known = failure(error);
      if (known) return known;
      return traced("setKitExpectation", "db_error", "Could not update the kit rule", error);
    }
    return toKitExpectationDto(data as unknown as ExpectationRow);
  }

  const { data, error } = await admin
    .from("kit_expectations")
    .insert({
      org_id: orgId,
      asset_type_id: input.assetTypeId,
      unit_kind: input.unitKind,
      vehicle_id: vehicleId,
      trailer_id: trailerId,
      quantity: input.quantity,
    })
    .select(COLUMNS)
    .single();
  if (error) {
    const known = failure(error);
    if (known) return known;
    return traced("setKitExpectation", "db_error", "Could not create the kit rule", error);
  }
  return toKitExpectationDto(data as unknown as ExpectationRow);
}

/**
 * Remove one rule.
 *
 * A real delete, unlike anything else in this module. An expectation is not evidence of anything
 * that happened — it is a rule about a unit that still exists — which is also why 0333 gives its
 * unit references `on delete cascade` where every movement's are `restrict`. Removing a per-unit
 * override puts that unit back on the fleet default, which is the whole point of the two layers.
 */
export async function deleteKitExpectation(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<boolean | ServiceError> {
  const { data, error } = await admin
    .from("kit_expectations")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return traced("deleteKitExpectation", "db_error", "Could not remove the kit rule", error);
  return Boolean(data);
}
