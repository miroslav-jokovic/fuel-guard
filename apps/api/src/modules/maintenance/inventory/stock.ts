import type { SupabaseClient } from "@supabase/supabase-js";
import { isLowStock, type StockLineDto, type StockLocationDto } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * Stock lines — one part at one location (INVENTORY-PLAN.md step I2, D-INV4).
 *
 * ── `quantity_on_hand` IS READ HERE AND WRITTEN NOWHERE ────────────────────────────────────────
 * Nothing in this file updates a quantity, and nothing in this module outside `record_part_movement`
 * ever will. It is the projection of `part_movements`; a service that could set it directly would be
 * a second source of truth, and the write that did it is the partial upsert `lint:upserts` forbids.
 *
 * ── aisle / row / bin ARE OPTIONAL, ALWAYS ─────────────────────────────────────────────────────
 * The owner measured the shop on 2026-09-09: it has no shelf numbers. Every read here treats the
 * three fragments as absent by default, and no sort or filter depends on them. What addresses a
 * shelf in this shop is `tag_code` — the label, resolved by D-INV7 — and the fragments are for a
 * shop that someday numbers its shelves.
 */

const LOCATION_COLUMNS = "id, name, code, address, active";

const STOCK_COLUMNS =
  "part_id, location_id, quantity_on_hand, reorder_point, reorder_quantity, aisle, row, bin, tag_code, active, " +
  "parts!inner(part_number, description, unit_of_measure, last_cost), " +
  "stock_locations!inner(name)";

interface StockRow {
  part_id: string;
  location_id: string;
  quantity_on_hand: number;
  reorder_point: number | null;
  reorder_quantity: number | null;
  aisle: string | null;
  row: string | null;
  bin: string | null;
  tag_code: string | null;
  active: boolean;
  parts: {
    part_number: string;
    description: string;
    unit_of_measure: StockLineDto["unitOfMeasure"];
    last_cost: number | string | null;
  } | null;
  stock_locations: { name: string } | null;
}

interface LocationRow {
  id: string;
  name: string;
  code: string;
  address: string | null;
  active: boolean;
}

export const toStockLineDto = (r: StockRow): StockLineDto => ({
  partId: r.part_id,
  locationId: r.location_id,
  partNumber: r.parts?.part_number ?? "",
  partDescription: r.parts?.description ?? "",
  locationName: r.stock_locations?.name ?? "",
  unitOfMeasure: r.parts?.unit_of_measure ?? "each",
  quantityOnHand: Number(r.quantity_on_hand),
  reorderPoint: r.reorder_point,
  reorderQuantity: r.reorder_quantity,
  aisle: r.aisle,
  row: r.row,
  bin: r.bin,
  tagCode: r.tag_code,
  lastCost: r.parts?.last_cost === null || r.parts?.last_cost === undefined ? null : Number(r.parts.last_cost),
  active: r.active,
});

export async function listLocations(
  admin: SupabaseClient,
  orgId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<StockLocationDto[] | ServiceError> {
  let q = admin.from("stock_locations").select(LOCATION_COLUMNS).eq("org_id", orgId);
  if (!opts.includeInactive) q = q.eq("active", true);
  const { data, error } = await q.order("name", { ascending: true }).limit(PAGE_MAX);
  if (error) return traced("listLocations", "db_error", "Could not load stock locations", error);
  return ((data ?? []) as LocationRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    address: r.address,
    active: r.active,
  }));
}

export interface ListStockOptions {
  locationId?: string;
  partId?: string;
  /** D-INV12's low-stock question, asked of the same reader rather than a second one. */
  belowReorderOnly?: boolean;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

export async function listStock(
  admin: SupabaseClient,
  orgId: string,
  opts: ListStockOptions = {},
): Promise<{ lines: StockLineDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  let q = admin.from("part_stock").select(STOCK_COLUMNS, { count: "exact" }).eq("org_id", orgId);
  if (!opts.includeInactive) q = q.eq("active", true);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);
  if (opts.partId) q = q.eq("part_id", opts.partId);

  const { data, error, count } = await q
    .order("part_id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return traced("listStock", "db_error", "Could not load stock", error);

  let lines = ((data ?? []) as unknown as StockRow[]).map(toStockLineDto);
  // The low-stock rule is `isLowStock` in `inventoryRules.ts` and it is CALLED here, not restated.
  // Writing `reorder_point is not null and quantity_on_hand <= reorder_point` into this query would
  // be a second copy of a threshold — and the rule has a real edge the copy loses, because a reorder
  // point of zero is meaningful and a null one is not a shortage. `idx_part_stock_reorder` exists
  // for the day this must move into SQL; that day is a measurement, not this step.
  if (opts.belowReorderOnly) lines = lines.filter(isLowStock);
  return { lines, total: opts.belowReorderOnly ? lines.length : (count ?? 0) };
}
