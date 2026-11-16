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

const COLUMNS = "id, name, code, address, active, fleetpal_from";

interface LocationRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  active: boolean;
  fleetpal_from: string | null;
}

const toDto = (r: LocationRow): StockLocationDto => ({
  id: r.id,
  name: r.name,
  code: r.code,
  address: r.address,
  active: r.active,
  fleetpalFrom: r.fleetpal_from,
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

/**
 * Start or stop this place following FleetPal (F13, D-FP23).
 *
 * Starting stamps `now()` — the server's clock, never a date from the request — so the shelf takes
 * FleetPal's deliveries and repairs from this moment on and none from before it. Stopping clears the
 * stamp; starting again later stamps a NEW now, and whatever FleetPal recorded in between never
 * reaches the shelf. That gap is the honest result of switching it off, and a count closes it.
 *
 * The partial unique index from 0621 allows one place per org. A second start is refused by name
 * rather than moving the switch silently, because which shelf FleetPal fills is the shop's call.
 * A closed place cannot start: `record_part_movement` refuses an inactive location (IV012), so a
 * switch on one would be a switch that does nothing.
 */
export async function setFleetpalShelf(
  admin: SupabaseClient,
  orgId: string,
  locationId: string,
  follows: boolean,
): Promise<StockLocationDto | null | ServiceError> {
  if (follows) {
    const current = await admin
      .from("stock_locations")
      .select(COLUMNS)
      .eq("org_id", orgId)
      .eq("id", locationId)
      .maybeSingle();
    if (current.error) return traced("setFleetpalShelf", "db_error", "Could not load the location", current.error);
    if (!current.data) return null;
    const row = current.data as unknown as LocationRow;
    if (!row.active) return { error: "Reopen this place before it can follow FleetPal.", code: "location_closed" };
    // Already following: keep the original start. Re-stamping would silently drop everything FleetPal
    // recorded between the two clicks.
    if (row.fleetpal_from) return toDto(row);
  }
  const { data, error } = await admin
    .from("stock_locations")
    .update({ fleetpal_from: follows ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", locationId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return {
        error: "Another place already follows FleetPal. Stop it there first — FleetPal moves one shelf.",
        code: "fleetpal_shelf_taken",
      };
    }
    return traced("setFleetpalShelf", "db_error", "Could not change whether the place follows FleetPal", error);
  }
  return data ? toDto(data as unknown as LocationRow) : null;
}
