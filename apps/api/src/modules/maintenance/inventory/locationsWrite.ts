import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockLocationDto, StockLocationInput } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import type { ServiceError } from "./types.js";

/**
 * Writing a stock location (INVENTORY-PLAN.md step I3, D-INV1).
 *
 * Deactivated, never deleted, and here the database is emphatic about it: `part_stock.location_id`
 * and `part_movements.location_id` are both `on delete restrict`. `record_part_movement` refuses an
 * INACTIVE location outright (`IV012`) rather than allowing a correction the way a retired part does
 * — a shelf that has been closed is not somewhere anything can still be counted, and the honest move
 * is to transfer the stock off it first.
 */

const COLUMNS = "id, name, code, address, active";

const toDto = (r: { id: string; name: string; code: string; address: string | null; active: boolean }): StockLocationDto => ({
  id: r.id,
  name: r.name,
  code: r.code,
  address: r.address,
  active: r.active,
});

const row = (input: Partial<StockLocationInput>) => {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.code !== undefined) out.code = input.code;
  if (input.address !== undefined) out.address = input.address;
  if (input.active !== undefined) out.active = input.active;
  return out;
};

export async function createLocation(
  admin: SupabaseClient,
  orgId: string,
  input: StockLocationInput,
): Promise<StockLocationDto | ServiceError> {
  const { data, error } = await admin
    .from("stock_locations")
    .insert({ org_id: orgId, ...row(input) })
    .select(COLUMNS)
    .single();
  if (error) {
    // The unique index is on `lower(code)`, so MAIN and main are the same shelf said two ways.
    if (error.code === "23505") {
      return { error: `Location code ${input.code} is already in use.`, code: "duplicate_location_code" };
    }
    return traced("createLocation", "db_error", "Could not create the location", error);
  }
  return toDto(data as never);
}

export async function updateLocation(
  admin: SupabaseClient,
  orgId: string,
  locationId: string,
  input: Partial<StockLocationInput>,
): Promise<StockLocationDto | null | ServiceError> {
  const patch = row(input);
  if (Object.keys(patch).length === 0) return { error: "Nothing to change.", code: "empty_patch" };
  const { data, error } = await admin
    .from("stock_locations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", locationId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return { error: `Location code ${input.code} is already in use.`, code: "duplicate_location_code" };
    }
    return traced("updateLocation", "db_error", "Could not update the location", error);
  }
  return data ? toDto(data as never) : null;
}
