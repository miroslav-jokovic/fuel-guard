import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockLineSettings } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import type { ServiceError } from "./types.js";

/**
 * What a desk user may set on a stock line (INVENTORY-PLAN.md; `stockLineSettingsSchema`).
 *
 * ── WHY THIS EXISTS AT ALL, WHICH THE PLAN DOES NOT SAY ────────────────────────────────────────
 * ⚠ Written 2026-09-09, by the review of I0–I3, and it closes a gap in the PLAN rather than in an
 * implementation. `stockLineSettingsSchema` shipped in I1 with no consumer; no step assigns the
 * write; and I12 is "Low stock", which READS `reorder_point`. Followed literally, the programme
 * would have shipped a low-stock screen reading a column nothing in the product could ever set —
 * permanently empty, and empty for a reason no screen could explain. The reorder point is also the
 * only field here that does any work today; the bin fragments are optional because this shop has no
 * shelf numbers, and `tag_code` is assigned by I10 and never typed.
 *
 * ── QUANTITY IS NOT IN THIS FILE, AND THAT IS THE POINT ────────────────────────────────────────
 * `stockLineSettingsSchema` has no `quantityOnHand` and neither does the row builder below. The
 * quantity is the ledger's projection (D-INV4) and `record_part_movement` is its only writer; a
 * settings route that could also set it would be the exact write `lint:upserts` forbids and would
 * destroy the evidence answering "where did the eleventh filter go".
 *
 * ── UPDATE, THEN INSERT — NEVER `.upsert()` WITH A PARTIAL PAYLOAD ─────────────────────────────
 * A reorder point may legitimately be set on a part/location pair that has never moved, so the row
 * may not exist. The house pattern (migrations 0174/0175, root CLAUDE.md) is a guarded UPDATE and
 * then an INSERT carrying EVERY not-null column — because Postgres checks NOT NULL before it
 * arbitrates the conflict, so the convenient `.upsert(patch)` is the one that fails in production
 * and not in a test.
 */

const row = (settings: StockLineSettings) => {
  const out: Record<string, unknown> = {};
  if (settings.reorderPoint !== undefined) out.reorder_point = settings.reorderPoint;
  if (settings.reorderQuantity !== undefined) out.reorder_quantity = settings.reorderQuantity;
  if (settings.aisle !== undefined) out.aisle = settings.aisle;
  if (settings.row !== undefined) out.row = settings.row;
  if (settings.bin !== undefined) out.bin = settings.bin;
  if (settings.active !== undefined) out.active = settings.active;
  return out;
};

export async function updateStockLine(
  admin: SupabaseClient,
  orgId: string,
  partId: string,
  locationId: string,
  settings: StockLineSettings,
): Promise<boolean | ServiceError> {
  const patch = row(settings);
  if (Object.keys(patch).length === 0) return { error: "Nothing to change.", code: "empty_patch" };

  const { data, error } = await admin
    .from("part_stock")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("part_id", partId)
    .eq("location_id", locationId)
    .select("part_id")
    .maybeSingle();
  if (error) return traced("updateStockLine", "db_error", "Could not update the stock line", error);
  if (data) return true;

  // No line yet. Create it at zero — a full payload, so this is an INSERT and not the partial upsert
  // the gate forbids. `quantity_on_hand` defaults to 0 and is stated here so nobody has to check.
  const { error: insertError } = await admin
    .from("part_stock")
    .insert({ org_id: orgId, part_id: partId, location_id: locationId, quantity_on_hand: 0, ...patch });
  if (insertError) {
    // 23503: the part or the location is not this org's, or does not exist. The FK is the check.
    if (insertError.code === "23503") {
      return { error: "That part or stock location is not available.", code: "IV012" };
    }
    return traced("updateStockLine", "db_error", "Could not create the stock line", insertError);
  }
  return true;
}
