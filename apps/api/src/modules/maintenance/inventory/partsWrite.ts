import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartDto, PartInput } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import { toPartDto } from "./parts.js";
import type { ServiceError } from "./types.js";

/**
 * Writing a part definition (INVENTORY-PLAN.md step I3).
 *
 * ── A PART IS DEACTIVATED, NEVER DELETED ───────────────────────────────────────────────────────
 * `part_movements.part_id` is `on delete restrict`, so a part that has ever moved cannot be removed
 * and the database says so rather than this service remembering to. `active` is the whole lifecycle:
 * a retired part disappears from the pickers and keeps its history, and `record_part_movement` still
 * accepts a `counted` or `adjusted` row against it so the leftover quantity can be written down.
 *
 * There is deliberately no delete route at all. The one case it would serve — a part typed by
 * mistake, before it ever moved — is served by deactivation just as well, and a delete that works
 * only sometimes is a button whose behaviour depends on history the person cannot see.
 */

const WRITE_COLUMNS =
  "id, part_number, description, manufacturer, category, unit_of_measure, upc, image_path, last_cost, active, notes";

const row = (input: Partial<PartInput>) => {
  const out: Record<string, unknown> = {};
  if (input.partNumber !== undefined) out.part_number = input.partNumber;
  if (input.description !== undefined) out.description = input.description;
  if (input.manufacturer !== undefined) out.manufacturer = input.manufacturer;
  if (input.category !== undefined) out.category = input.category;
  if (input.unitOfMeasure !== undefined) out.unit_of_measure = input.unitOfMeasure;
  if (input.upc !== undefined) out.upc = input.upc;
  if (input.notes !== undefined) out.notes = input.notes;
  if (input.active !== undefined) out.active = input.active;
  return out;
};

/**
 * `insert`, never `upsert`. A partial upsert is what `lint:upserts` forbids — Postgres checks NOT
 * NULL before it arbitrates the conflict — and there is nothing to arbitrate here anyway: a repeated
 * part number is a mistake worth reporting, not a row worth merging.
 */
export async function createPart(
  admin: SupabaseClient,
  orgId: string,
  input: PartInput,
): Promise<PartDto | ServiceError> {
  const { data, error } = await admin
    .from("parts")
    .insert({ org_id: orgId, ...row(input) })
    .select(WRITE_COLUMNS)
    .single();
  if (error) {
    // 23505 on `idx_parts_number`: the catalogue already has this number. A person can act on that
    // sentence; "db_error" sends them to whoever reads the logs.
    if (error.code === "23505") {
      return { error: `Part number ${input.partNumber} is already in the catalogue.`, code: "duplicate_part_number" };
    }
    return traced("createPart", "db_error", "Could not create the part", error);
  }
  return toPartDto(data as never);
}

export async function updatePart(
  admin: SupabaseClient,
  orgId: string,
  partId: string,
  input: Partial<PartInput>,
): Promise<PartDto | null | ServiceError> {
  const patch = row(input);
  if (Object.keys(patch).length === 0) {
    return { error: "Nothing to change.", code: "empty_patch" };
  }
  const { data, error } = await admin
    .from("parts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", partId)
    .select(WRITE_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return { error: `Part number ${input.partNumber} is already in the catalogue.`, code: "duplicate_part_number" };
    }
    return traced("updatePart", "db_error", "Could not update the part", error);
  }
  return data ? toPartDto(data as never) : null;
}

/** Records where a part's photo lives. Separate from `updatePart` because the path is produced by the upload flow, not typed by anybody. */
export async function setPartImagePath(
  admin: SupabaseClient,
  orgId: string,
  partId: string,
  imagePath: string,
): Promise<boolean | ServiceError> {
  const { data, error } = await admin
    .from("parts")
    .update({ image_path: imagePath, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", partId)
    .select("id")
    .maybeSingle();
  if (error) return traced("setPartImagePath", "db_error", "Could not attach the photo", error);
  return Boolean(data);
}
