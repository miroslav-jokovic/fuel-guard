import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetTypeDto, AssetTypeInput } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { PAGE_MAX } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * Asset types — "tablet", "load bar", "ratchet strap" (INVENTORY-PLAN.md step I7).
 *
 * ── `serialized` IS THE DECISION THIS TABLE EXISTS TO CARRY ────────────────────────────────────
 * It decides whether individual identity is worth tracking, and it is a property of the KIND of
 * thing rather than a setting on the org. A tablet is serialized: which one matters, because it has
 * a serial number, a warranty and a repair history. Ratchet straps are not: four straps are four
 * straps. `move_asset` reads it — `IV020` fires only for a serialized type — so a shop that marks
 * straps serialized would find itself unable to put a fourth one in a trailer.
 *
 * ── AND WHY THERE IS NO DELETE ─────────────────────────────────────────────────────────────────
 * `inventory_assets.asset_type_id` is `on delete restrict`, so a type that has ever been used
 * cannot be removed and the database says so rather than this service remembering to. The one case
 * a delete would serve — a type typed by mistake and never used — is not worth a button whose
 * behaviour depends on history the person cannot see; `partsWrite.ts` makes the same call for the
 * same reason. `kit_expectations.asset_type_id` cascades, because an expectation is a rule about a
 * type and not evidence of anything.
 */

const COLUMNS = "id, name, category, serialized, default_kit_quantity, image_path";

interface TypeRow {
  id: string;
  name: string;
  category: string | null;
  serialized: boolean;
  default_kit_quantity: number;
  image_path: string | null;
}

export const toAssetTypeDto = (r: TypeRow): AssetTypeDto => ({
  id: r.id,
  name: r.name,
  category: r.category,
  serialized: r.serialized,
  defaultKitQuantity: Number(r.default_kit_quantity),
  imagePath: r.image_path,
});

export async function listAssetTypes(
  admin: SupabaseClient,
  orgId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ types: AssetTypeDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  const { data, error, count } = await admin
    .from("asset_types")
    .select(COLUMNS, { count: "exact" })
    .eq("org_id", orgId)
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) return traced("listAssetTypes", "db_error", "Could not load the asset types", error);
  return { types: ((data ?? []) as unknown as TypeRow[]).map(toAssetTypeDto), total: count ?? 0 };
}

const row = (input: Partial<AssetTypeInput>) => {
  const out: Record<string, unknown> = {};
  if (input.name !== undefined) out.name = input.name;
  if (input.category !== undefined) out.category = input.category;
  if (input.serialized !== undefined) out.serialized = input.serialized;
  if (input.defaultKitQuantity !== undefined) out.default_kit_quantity = input.defaultKitQuantity;
  return out;
};

/** `insert`, never `upsert` — a partial upsert is what `lint:upserts` forbids, and a repeated type name is a mistake worth reporting rather than a row worth merging. */
export async function createAssetType(
  admin: SupabaseClient,
  orgId: string,
  input: AssetTypeInput,
): Promise<AssetTypeDto | ServiceError> {
  const { data, error } = await admin
    .from("asset_types")
    .insert({ org_id: orgId, ...row(input) })
    .select(COLUMNS)
    .single();
  if (error) {
    // 23505 on `idx_asset_types_name`, which is case-folded: "Tablet" and "tablet" are one type,
    // because two of them would split a kit expectation down the middle and nobody would see why.
    if (error.code === "23505") {
      return { error: `There is already a type called ${input.name}.`, code: "duplicate_asset_type" };
    }
    return traced("createAssetType", "db_error", "Could not create the asset type", error);
  }
  return toAssetTypeDto(data as unknown as TypeRow);
}

export async function updateAssetType(
  admin: SupabaseClient,
  orgId: string,
  typeId: string,
  input: Partial<AssetTypeInput>,
): Promise<AssetTypeDto | null | ServiceError> {
  const patch = row(input);
  if (Object.keys(patch).length === 0) return { error: "Nothing to change.", code: "empty_patch" };

  const { data, error } = await admin
    .from("asset_types")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", typeId)
    .select(COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return { error: `There is already a type called ${input.name}.`, code: "duplicate_asset_type" };
    }
    return traced("updateAssetType", "db_error", "Could not update the asset type", error);
  }
  return data ? toAssetTypeDto(data as unknown as TypeRow) : null;
}
