import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssetTypeDto, AssetTypeInput } from "@silvicom/shared";
import { STANDARD_KIT_LINES, STANDARD_KIT_TYPES } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { PAGE_MAX } from "./parts.js";
import { isServiceError, type ServiceError } from "./types.js";
import { setKitExpectation } from "./kitExpectations.js";

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

/**
 * Adopt the standard kit — A4's answer, applied to an org that has none (2026-09-09).
 *
 * ── IT IS IDEMPOTENT, AND THAT IS WHAT MAKES IT SAFE TO OFFER AS A BUTTON ─────────────────────
 * A type whose name the org already has is left exactly as it is — not renamed, not re-categorised,
 * not un-serialized — and its kit line is written all the same. So a second tap changes nothing, and
 * a shop that has already made its own "Load bar" keeps it and gains the rule. The match is on
 * `lower(name)`, which is `idx_asset_types_name`'s own rule.
 *
 * ── AND IT DOES NOT TOUCH A RULE SOMEBODY HAS ALREADY WRITTEN ─────────────────────────────────
 * The fleet rules go through `setKitExpectation`, which is UPDATE-then-INSERT on the natural key —
 * so adopting the kit twice writes the same numbers twice, and a shop that has since decided its
 * trailers carry six straps would have that overwritten back to four. That is the one destructive
 * edge, and it is why the SCREEN offers this only while the org has no types at all: the button is
 * a first run, not a reset. The service does not enforce that, because a service that refused would
 * be unable to say why.
 */
export async function adoptStandardKit(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ typesCreated: number; rulesSet: number } | ServiceError> {
  const existing = await listAssetTypes(admin, orgId, { limit: 200 });
  if (isServiceError(existing)) return existing;

  const byName = new Map(existing.types.map((t) => [t.name.toLowerCase(), t.id]));
  let typesCreated = 0;

  for (const type of STANDARD_KIT_TYPES) {
    if (byName.has(type.name.toLowerCase())) continue;
    const created = await createAssetType(admin, orgId, {
      name: type.name,
      category: type.category,
      serialized: type.serialized,
      // Zero: the kit LINES below say how many a unit carries, per kind. A non-zero default here
      // would apply to every kind of unit at once — there is no kind on `asset_types` — so a
      // tractor would start expecting four ratchet straps.
      defaultKitQuantity: 0,
    });
    if (isServiceError(created)) return created;
    byName.set(type.name.toLowerCase(), created.id);
    typesCreated += 1;
  }

  let rulesSet = 0;
  for (const line of STANDARD_KIT_LINES) {
    const assetTypeId = byName.get(line.typeName.toLowerCase());
    // Unreachable unless the catalogue names a line whose type it does not list; a missing type is
    // skipped rather than throwing, because half a kit is more useful than none and the screen
    // reports what it wrote.
    if (!assetTypeId) continue;
    const set = await setKitExpectation(admin, orgId, {
      assetTypeId,
      unitKind: line.unitKind,
      quantity: line.quantity,
    });
    if (isServiceError(set)) return set;
    rulesSet += 1;
  }

  return { typesCreated, rulesSet };
}
