import type { SupabaseClient } from "@supabase/supabase-js";
import type { PartDto } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import type { ServiceError } from "./types.js";

/**
 * Parts — the definitions, not the stock (INVENTORY-PLAN.md step I2, D-INV1).
 *
 * ── EVERY QUERY ORG-FILTERS ITSELF, AND THAT IS NOT BELT AND BRACES ────────────────────────────
 * The API reads with the service role, which BYPASSES RLS. The policies in 0331 protect a browser
 * session and protect nothing here. So `.eq("org_id", orgId)` on every read is the ONLY tenant
 * boundary this layer has, which is why `expectOrgScoped` asserts it on every recorded query in the
 * companion test rather than on a sample of them.
 */

const COLUMNS =
  "id, part_number, description, manufacturer, category, unit_of_measure, upc, image_path, last_cost, active, notes";

interface PartRow {
  id: string;
  part_number: string;
  description: string;
  manufacturer: string | null;
  category: string | null;
  unit_of_measure: PartDto["unitOfMeasure"];
  upc: string | null;
  image_path: string | null;
  last_cost: number | string | null;
  active: boolean;
  notes: string | null;
}

/**
 * `numeric` arrives from PostgREST as a STRING, not a number — Postgres will not risk a float
 * rounding a money column on the way out. `partDtoSchema.lastCost` is `z.number().nullable()`, so
 * handing the row straight through would fail validation at the edge for every part that has a
 * cost, which is every part anybody has ever received.
 */
const money = (v: number | string | null): number | null => (v === null ? null : Number(v));

export const toPartDto = (r: PartRow): PartDto => ({
  id: r.id,
  partNumber: r.part_number,
  description: r.description,
  manufacturer: r.manufacturer,
  category: r.category,
  unitOfMeasure: r.unit_of_measure,
  upc: r.upc,
  imagePath: r.image_path,
  lastCost: money(r.last_cost),
  active: r.active,
  notes: r.notes,
});

export interface ListPartsOptions {
  /** Free text over part number and description. */
  search?: string;
  category?: string;
  /** Default false: a retired part is out of the way unless somebody asks for it. */
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * PostgREST caps EVERY response at 1,000 rows regardless of the `.limit()` asked for, so this pages
 * explicitly rather than trusting a large limit. That cap is not theoretical here: it cost nine
 * filter menus 30 % of their values once, silently, and a parts catalogue is exactly the shape of
 * list that grows past a thousand without anybody deciding to.
 */
export const PAGE_MAX = 200;

export async function listParts(
  admin: SupabaseClient,
  orgId: string,
  opts: ListPartsOptions = {},
): Promise<{ parts: PartDto[]; total: number } | ServiceError> {
  const limit = Math.min(opts.limit ?? PAGE_MAX, PAGE_MAX);
  const offset = Math.max(opts.offset ?? 0, 0);

  let q = admin.from("parts").select(COLUMNS, { count: "exact" }).eq("org_id", orgId);
  if (!opts.includeInactive) q = q.eq("active", true);
  if (opts.category) q = q.eq("category", opts.category);
  if (opts.search?.trim()) {
    const term = `%${opts.search.trim()}%`;
    q = q.or(`part_number.ilike.${term},description.ilike.${term}`);
  }

  const { data, error, count } = await q.order("part_number", { ascending: true }).range(offset, offset + limit - 1);
  if (error) return traced("listParts", "db_error", "Could not load parts", error);
  return { parts: ((data ?? []) as PartRow[]).map(toPartDto), total: count ?? 0 };
}

export async function getPart(
  admin: SupabaseClient,
  orgId: string,
  partId: string,
): Promise<PartDto | null | ServiceError> {
  const { data, error } = await admin
    .from("parts")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("id", partId)
    .maybeSingle();
  if (error) return traced("getPart", "db_error", "Could not load the part", error);
  return data ? toPartDto(data as PartRow) : null;
}

/**
 * The UPC fall-through behind D-INV7's resolver: an unrecognised scan is tried as a supplier barcode
 * before it is called unknown. Deliberately returns a LIST — a fleet that stocks the same filter
 * under two part numbers has two rows for one barcode, and picking one of them here would make the
 * scanner quietly wrong rather than visibly ambiguous.
 */
export async function findPartsByUpc(
  admin: SupabaseClient,
  orgId: string,
  upc: string,
): Promise<PartDto[] | ServiceError> {
  const { data, error } = await admin
    .from("parts")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("upc", upc)
    .eq("active", true)
    .order("part_number", { ascending: true })
    .limit(PAGE_MAX);
  if (error) return traced("findPartsByUpc", "db_error", "Could not look up the barcode", error);
  return ((data ?? []) as PartRow[]).map(toPartDto);
}
