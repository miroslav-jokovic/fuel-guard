import {
  fleetpalShopSchema,
  fleetpalVendorSchema,
  type FleetpalShop,
  type FleetpalVendor,
} from "@silvicom/shared";
import { FleetpalError } from "../errors.js";
import { advance, getSyncState, recordFailure } from "../syncState.js";
import type { IngestContext, IngestResult, ResourceIngest } from "./types.js";

/**
 * The two reference lists a repair points at (FLEETPAL-INTEGRATION-PLAN.md F6, §2.7).
 *
 * They are in the same file because they are the same job at two different sync tiers, and the
 * difference is the interesting part: **`Vendor` carries `updated` and `Shop` does not.** So
 * vendors watermark like everything else, and shops are re-read whole every time — which costs
 * nothing (one row on the live account, 2026-09-21) and is the only correct answer, because a
 * renamed shop is invisible to a watermark that has nothing to read.
 *
 * ── DATA THE VENDOR HAS AND WE DECLINE ────────────────────────────────────────────────────────
 * Email, phone, website and street address are dropped on both. A repair report says "Love's, Fort
 * Stockton TX"; nothing in this product writes to a supplier. What we do not hold cannot leak, and
 * the column that does not exist is the only one that cannot quietly start being displayed.
 */

export const vendorsIngest: ResourceIngest<FleetpalVendor> = {
  resource: "vendors",
  path: "/v1/vendors/",
  rpc: "stage_fleetpal_vendors",
  schema: fleetpalVendorSchema,
  updatedOf: (row) => row.updated,
  map: (row) => ({
    fleetpal_id: row.id,
    name: row.name,
    vendor_type: row.type,
    // ⚠ Populated on 1 of 761 (F4). Staged because one is not none and a shop may fill in the rest;
    // the coverage ratio must not be built on it until it is — Q9.
    code: row.code,
    city: row.city,
    state: row.state,
    country: row.country,
    zip_code: row.zip_code,
    payment_term_fleetpal_id: row.payment_term,
    payment_method: row.payment_method,
    vendor_created_at: row.created,
    vendor_updated_at: row.updated,
  }),
};

/**
 * Shops, re-read in full.
 *
 * ⚠ **This writes `window_end`, not `watermark`.** `Shop` has no `updated` field and its endpoint
 * takes no `updated_after`, so there is no high-water mark to store — the position here is "when we
 * last re-read the whole list". Writing that into `watermark` would make a later reader treat it as
 * one and filter by it, which for a resource that cannot be filtered means asking for a parameter
 * the vendor ignores, and for a resource that can means skipping everything that changed without
 * being re-created. `fleetpal_sync_state` has two columns precisely so this cannot be fudged.
 */
export async function ingestShops(ctx: IngestContext): Promise<IngestResult> {
  const { admin, client, orgId } = ctx;
  const resource = "shops";
  await getSyncState(admin, orgId, resource); // read for symmetry; a full re-read ignores the position

  try {
    const rows = await client.walk("/v1/shops/", fleetpalShopSchema, {});
    if (rows.length === 0) {
      return { resource, fetched: 0, staged: 0, advancedTo: null, error: null };
    }
    const payload = rows.map((row: FleetpalShop) => ({
      fleetpal_id: row.id,
      name: row.name,
      code: row.code,
      city: row.city,
      state: row.state,
      country: row.country,
      zip_code: row.zip_code,
      hourly_labor_rate: row.hourly_labor_rate,
      vendor_created_at: row.created,
    }));

    const { error } = await admin.rpc("stage_fleetpal_shops", { p_org: orgId, p_rows: payload });
    if (error) {
      await recordFailure(admin, orgId, resource, error.message);
      return { resource, fetched: rows.length, staged: 0, advancedTo: null, error: error.message };
    }

    const now = new Date().toISOString();
    const moved = await advance(admin, orgId, resource, { kind: "window", to: now }, rows.length);
    if ("error" in moved) {
      return { resource, fetched: rows.length, staged: rows.length, advancedTo: null, error: moved.error };
    }
    return { resource, fetched: rows.length, staged: rows.length, advancedTo: now, error: null };
  } catch (e) {
    const message = e instanceof FleetpalError ? `${e.kind}: ${e.message}` : String(e);
    await recordFailure(admin, orgId, resource, message);
    return { resource, fetched: 0, staged: 0, advancedTo: null, error: message };
  }
}
