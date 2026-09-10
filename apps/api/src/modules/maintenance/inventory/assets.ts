import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetDto, AssetHolder, AssetStatus, HolderKind } from "@silvicom/shared";
import { nextDisplayNo } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { orFilterValue } from "../../../lib/postgrestFilters.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * The assets — the half of the shop's inventory that has identities (INVENTORY-PLAN.md step I7,
 * D-INV3, D-INV18, D-INV24).
 *
 * ── WHAT THIS FILE OWNS, GIVEN 0333 EXISTS ─────────────────────────────────────────────────────
 * `supabase/tests/inventory-assets.test.mjs` owns the schema's promises: one holder at a time, the
 * holder belongs to this org, the holder columns equal the last movement. Nothing here repeats any
 * of that, because a service cannot make those true and a mock cannot prove them.
 *
 * What is only true in TypeScript is the assembly of the DTO, and there are three pieces of it:
 *
 *   · **the holder is three columns and one object.** No caller should have to know that
 *     "unassigned" is spelled as three nulls, or that a truck's name lives in a different join from
 *     a bay's. `holderOf` is the one place that translation happens.
 *   · **`displayNo` is DERIVED, not stored.** The database allocates `display_seq` under a lock and
 *     `nextDisplayNo` in `@silvicom/shared` owns the format — the same split `tagContract.ts`
 *     insists on for the tag grammar, and for the same reason: a second spelling of an identifier
 *     is how a label prints fine and scans to nothing.
 *   · **the driver is INFERRED and never stored (D-INV3).** A tablet's holder is unit 654; the
 *     person is whoever `vehicles.assigned_driver_id` names at the moment somebody looks. There is
 *     no driver column anywhere in 0333 and there is no handover signature, which is a legal
 *     position rather than a modelling shortcut — see `inventoryAssetContract.ts`'s header.
 */

/**
 * What a list or a detail selects. Three joins because the holder is one of three things.
 *
 * Exported so the `AST` tag resolver reads an asset the same way this file does — a second column
 * list would be a second answer to "what is an asset", and the two would drift on the next column.
 */
export const ASSET_COLUMNS =
  "id, tag_code, display_seq, asset_type_id, name, serial_number, model, manufacturer, status, " +
  "condition, location_id, vehicle_id, trailer_id, purchased_at, purchase_cost, warranty_expires_at, " +
  "image_path, notes, asset_types(name), stock_locations(name), vehicles(unit_number, assigned_driver_id), " +
  "trailers(unit_number)";

export interface AssetRow {
  id: string;
  tag_code: string | null;
  display_seq: number;
  asset_type_id: string;
  name: string;
  serial_number: string | null;
  model: string | null;
  manufacturer: string | null;
  status: AssetStatus;
  condition: AssetDto["condition"];
  location_id: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  purchased_at: string | null;
  purchase_cost: number | string | null;
  warranty_expires_at: string | null;
  image_path: string | null;
  notes: string | null;
  asset_types: { name: string } | null;
  stock_locations: { name: string } | null;
  vehicles: { unit_number: string | null; assigned_driver_id: string | null } | null;
  trailers: { unit_number: string | null } | null;
}

/**
 * The three holder columns as one object.
 *
 * `unassigned` is a real state and not a missing value: an asset still in its box, or one just
 * handed back with nowhere decided yet, is genuinely nowhere. 0333's CHECK is `<= 1` for exactly
 * that reason, where a count session's is `= 1`.
 */
export const holderOf = (
  r: Pick<AssetRow, "location_id" | "vehicle_id" | "trailer_id" | "stock_locations" | "vehicles" | "trailers">,
  extra: { inferredDriverName?: string | null; since?: string | null } = {},
): AssetHolder => {
  const kind: HolderKind = r.location_id
    ? "location"
    : r.vehicle_id
      ? "vehicle"
      : r.trailer_id
        ? "trailer"
        : "unassigned";
  const label =
    kind === "location"
      ? (r.stock_locations?.name ?? null)
      : kind === "vehicle"
        ? (r.vehicles?.unit_number ?? null)
        : kind === "trailer"
          ? (r.trailers?.unit_number ?? null)
          : null;
  return {
    kind,
    id: r.location_id ?? r.vehicle_id ?? r.trailer_id ?? null,
    label,
    // Only a truck has a driver. A trailer's driver is whoever is pulling it today, which is a
    // different question with a different answer, and the kit screen does not ask it.
    inferredDriverName: kind === "vehicle" ? (extra.inferredDriverName ?? null) : null,
    since: extra.since ?? null,
  };
};

export const toAssetDto = (
  r: AssetRow,
  extra: { inferredDriverName?: string | null; since?: string | null } = {},
): AssetDto => ({
  id: r.id,
  tagCode: r.tag_code,
  displayNo: nextDisplayNo(r.display_seq),
  assetTypeId: r.asset_type_id,
  assetTypeName: r.asset_types?.name ?? "",
  name: r.name,
  serialNumber: r.serial_number,
  model: r.model,
  manufacturer: r.manufacturer,
  status: r.status,
  condition: r.condition,
  holder: holderOf(r, extra),
  purchasedAt: r.purchased_at,
  purchaseCost: r.purchase_cost === null ? null : Number(r.purchase_cost),
  warrantyExpiresAt: r.warranty_expires_at,
  imagePath: r.image_path,
  notes: r.notes,
});

export interface ListAssetsOptions {
  /**
   * Free text over what a person knows about the thing: its name, serial, make and model, the tag
   * on it — and its number. "A-0412" or "412" reaches `display_seq`, because the number is what
   * the shop says out loud and the column is an integer nobody can `ilike`.
   */
  search?: string;
  assetTypeId?: string;
  status?: AssetStatus;
  locationId?: string;
  vehicleId?: string;
  trailerId?: string;
  /** The crib's "nothing decided yet" pile — three nulls, which no `.eq()` can ask for. */
  unassigned?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * The drivers of a page of assets, in one call.
 *
 * One query for the page and never one per row — `lib/memberLabels` exists to enforce that shape
 * for users and this is the same shape for drivers. `full_name` because it is the column the roster
 * maintains; assembling a name out of parts here would be a second spelling of somebody's name.
 */
async function driverNames(
  admin: SupabaseClient,
  orgId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await admin
    .from("drivers")
    .select("id, full_name")
    .eq("org_id", orgId)
    .in("id", unique);
  return new Map(
    ((data ?? []) as Array<{ id: string; full_name: string | null }>)
      .filter((d) => d.full_name)
      .map((d) => [d.id, d.full_name as string]),
  );
}

/**
 * The integer behind a display number, if the search term is one. `A-0412`, `a0412`, `0412` and
 * `412` all name display_seq 412; anything with letters after the prefix is not a number and gets
 * no sequence clause at all.
 */
export function displaySeqOf(term: string): number | null {
  const m = /^a?-?(\d{1,9})$/i.exec(term);
  return m ? Number(m[1]) : null;
}

export async function listAssets(
  admin: SupabaseClient,
  orgId: string,
  opts: ListAssetsOptions = {},
): Promise<{ assets: AssetDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  let q = admin.from("inventory_assets").select(ASSET_COLUMNS, { count: "exact" }).eq("org_id", orgId);
  if (opts.assetTypeId) q = q.eq("asset_type_id", opts.assetTypeId);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);
  if (opts.vehicleId) q = q.eq("vehicle_id", opts.vehicleId);
  if (opts.trailerId) q = q.eq("trailer_id", opts.trailerId);
  if (opts.unassigned) q = q.is("location_id", null).is("vehicle_id", null).is("trailer_id", null);
  if (opts.search?.trim()) {
    // ⚠ QUOTED, never interpolated raw — `parts.ts` carries the reason: `.or()` is one string
    // PostgREST parses, and a serial number with a comma in it would otherwise build a filter
    // nobody wrote. `orFilterValue` is the grammar's own escape.
    const raw = opts.search.trim();
    const term = orFilterValue(`%${raw}%`);
    const clauses = [
      `name.ilike.${term}`,
      `serial_number.ilike.${term}`,
      `manufacturer.ilike.${term}`,
      `model.ilike.${term}`,
      `tag_code.ilike.${term}`,
    ];
    const seq = displaySeqOf(raw);
    if (seq !== null) clauses.push(`display_seq.eq.${seq}`);
    q = q.or(clauses.join(","));
  }

  const { data, error, count } = await q
    .order("display_seq", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return traced("listAssets", "db_error", "Could not load the assets", error);

  const rows = (data ?? []) as unknown as AssetRow[];
  const names = await driverNames(
    admin,
    orgId,
    rows.map((r) => r.vehicles?.assigned_driver_id).filter((id): id is string => Boolean(id)),
  );
  return {
    assets: rows.map((r) =>
      toAssetDto(r, {
        inferredDriverName: r.vehicles?.assigned_driver_id
          ? (names.get(r.vehicles.assigned_driver_id) ?? null)
          : null,
      }),
    ),
    total: count ?? 0,
  };
}

/**
 * One asset, with the answer to "since when".
 *
 * ⚠ `since` is populated HERE and is null in `listAssets`, deliberately. It is the occurred_at of
 * the last movement that actually moved the thing, which is one bounded query for one asset and
 * would be an unbounded one for a page — and an unbounded read is how nine filter menus quietly
 * lost 30 % of their values to PostgREST's 1,000-row cap. The detail page is where the plan asks
 * for "holder, since when" (I8); the list asks only where it is.
 */
export async function getAsset(
  admin: SupabaseClient,
  orgId: string,
  id: string,
): Promise<AssetDto | null | ServiceError> {
  const { data, error } = await admin
    .from("inventory_assets")
    .select(ASSET_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) return traced("getAsset", "db_error", "Could not load the asset", error);
  if (!data) return null;

  const row = data as unknown as AssetRow;
  const { data: last } = await admin
    .from("asset_movements")
    .select("occurred_at")
    .eq("org_id", orgId)
    .eq("asset_id", id)
    // The reasons that leave the holder alone are not "since when" — a fridge reported missing in
    // March has been unit 654's since January (D-INV24, `HOLDER_PRESERVING_REASONS`).
    .not("reason", "in", "(reported_missing,reported_damaged)")
    .order("occurred_at", { ascending: false })
    .limit(1);
  const since = (last?.[0] as { occurred_at: string } | undefined)?.occurred_at ?? null;

  const driverId = row.vehicles?.assigned_driver_id ?? null;
  const names = await driverNames(admin, orgId, driverId ? [driverId] : []);
  return toAssetDto(row, {
    inferredDriverName: driverId ? (names.get(driverId) ?? null) : null,
    since,
  });
}
