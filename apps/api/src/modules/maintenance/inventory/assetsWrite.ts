import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetDto, AssetInput } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { toAssetDto, type AssetRow } from "./assets.js";
import type { ServiceError } from "./types.js";

/**
 * Creating and editing an asset (INVENTORY-PLAN.md step I7).
 *
 * ── THE HOLDER IS NOT WRITTEN HERE ─────────────────────────────────────────────────────────────
 * Nothing in this file touches `location_id`, `vehicle_id` or `trailer_id` after the opening
 * placement. `move_asset` is the only door those columns move through (D-INV3), because a move is a
 * ledger row AND a holder change and the two disagreeing is the failure the whole design exists to
 * prevent. An edit screen that could quietly re-home a tablet would leave its history saying it is
 * still in 611.
 *
 * The one exception is the OPENING position, taken at creation, and it writes no movement: an asset
 * unpacked onto the crib shelf was not moved there from anywhere. `rebuild_asset_holders` leaves
 * such an asset alone for exactly that reason, which
 * `supabase/tests/inventory-assets.test.mjs` pins by "...and leaves an asset that has never moved
 * where it was created".
 *
 * ── AND NEITHER IS `tag_code` ──────────────────────────────────────────────────────────────────
 * Issuing a tag needs randomness and a uniqueness check against this table, which `tagContract.ts`
 * deliberately does not carry and which lands at I10. 0333's `guard_inventory_asset` refuses a
 * change to a tag that is already set, for the service role too — a tag is printed onto polyester
 * and stuck to a tablet, so reprinting one is how two objects end up answering to a single code.
 */

const WRITE_COLUMNS =
  "id, tag_code, display_seq, asset_type_id, name, serial_number, model, manufacturer, status, " +
  "condition, location_id, vehicle_id, trailer_id, purchased_at, purchase_cost, warranty_expires_at, " +
  "image_path, notes, asset_types(name), stock_locations(name), vehicles(unit_number, assigned_driver_id), " +
  "trailers(unit_number)";

const row = (input: Partial<AssetInput>) => {
  const out: Record<string, unknown> = {};
  if (input.assetTypeId !== undefined) out.asset_type_id = input.assetTypeId;
  if (input.name !== undefined) out.name = input.name;
  if (input.serialNumber !== undefined) out.serial_number = input.serialNumber;
  if (input.model !== undefined) out.model = input.model;
  if (input.manufacturer !== undefined) out.manufacturer = input.manufacturer;
  if (input.status !== undefined) out.status = input.status;
  if (input.condition !== undefined) out.condition = input.condition;
  if (input.purchasedAt !== undefined) out.purchased_at = input.purchasedAt;
  if (input.purchaseCost !== undefined) out.purchase_cost = input.purchaseCost;
  if (input.warrantyExpiresAt !== undefined) out.warranty_expires_at = input.warrantyExpiresAt;
  if (input.notes !== undefined) out.notes = input.notes;
  return out;
};

/** Where a new asset starts life. All three optional, and all three absent is the crib's "nothing decided yet" pile. */
export interface OpeningHolder {
  locationId?: string | null;
  vehicleId?: string | null;
  trailerId?: string | null;
}

const failure = (error: { code?: string; message?: string }): ServiceError | null => {
  // 0333's guard: the bay, truck or trailer is not this org's, or the bay is closed. No foreign key
  // can say that — none of those tables carries an (id, org_id) unique constraint — so the trigger
  // is the only thing between the service role and another tenant's shelf.
  if (error.code === "IV012") {
    return { error: "That bay, truck or trailer is not available.", code: "IV012" };
  }
  if (error.code === "IV022") {
    return { error: "That tag is already on another asset, and a tag is never reprinted.", code: "IV022" };
  }
  // 23505 on `idx_inventory_assets_tag`: the same collision under concurrency, where both writers
  // passed the trigger's check and the unique index caught the loser. Same sentence, because it is
  // the same fact — see 0333's header on which of the two is the guarantee.
  if (error.code === "23505") {
    return { error: "That tag is already on another asset, and a tag is never reprinted.", code: "IV022" };
  }
  return null;
};

/**
 * `insert`, never `upsert`. `display_seq` is NOT NULL and is filled by 0333's trigger, which makes
 * a partial upsert exactly the shape `lint:upserts` forbids: Postgres checks NOT NULL on the
 * proposed tuple before it arbitrates the conflict.
 */
export async function createAsset(
  admin: SupabaseClient,
  orgId: string,
  input: AssetInput,
  holder: OpeningHolder = {},
): Promise<AssetDto | ServiceError> {
  const { data, error } = await admin
    .from("inventory_assets")
    .insert({
      org_id: orgId,
      ...row(input),
      location_id: holder.locationId ?? null,
      vehicle_id: holder.vehicleId ?? null,
      trailer_id: holder.trailerId ?? null,
    })
    .select(WRITE_COLUMNS)
    .single();
  if (error) {
    const known = failure(error);
    if (known) return known;
    // A CHECK refused it — two holders at once is the only way to reach this from a validated input.
    if (error.code === "23514") {
      return { error: "An asset is in one place at a time.", code: "malformed_asset" };
    }
    return traced("createAsset", "db_error", "Could not create the asset", error);
  }
  return toAssetDto(data as unknown as AssetRow);
}

/**
 * Edit the description of a thing — its name, serial, warranty, condition, notes.
 *
 * `status` is here and `retired` is not special-cased, deliberately: 0333 lets `move_asset` set it
 * when a `retired` movement is written, and this route lets an office correct a status that was
 * typed wrongly. What neither can do is move the thing, which is the column that matters.
 */
export async function updateAsset(
  admin: SupabaseClient,
  orgId: string,
  assetId: string,
  input: Partial<AssetInput>,
): Promise<AssetDto | null | ServiceError> {
  const patch = row(input);
  if (Object.keys(patch).length === 0) return { error: "Nothing to change.", code: "empty_patch" };

  const { data, error } = await admin
    .from("inventory_assets")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", assetId)
    .select(WRITE_COLUMNS)
    .maybeSingle();
  if (error) {
    const known = failure(error);
    if (known) return known;
    return traced("updateAsset", "db_error", "Could not update the asset", error);
  }
  return data ? toAssetDto(data as unknown as AssetRow) : null;
}

/** Records where an asset's photo lives. Separate from `updateAsset` because the path is produced by the upload flow, not typed by anybody — `setPartImagePath`'s shape. */
export async function setAssetImagePath(
  admin: SupabaseClient,
  orgId: string,
  assetId: string,
  imagePath: string,
): Promise<boolean | ServiceError> {
  const { data, error } = await admin
    .from("inventory_assets")
    .update({ image_path: imagePath, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", assetId)
    .select("id")
    .maybeSingle();
  if (error) return traced("setAssetImagePath", "db_error", "Could not attach the photo", error);
  return Boolean(data);
}
