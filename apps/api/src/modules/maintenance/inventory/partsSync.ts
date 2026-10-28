import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnitOfMeasure } from "@silvicom/shared";
import { traced } from "../inspections/serviceError.js";
import type { ServiceError } from "./types.js";

/**
 * A catalogue entry as FleetPal describes it, already reduced to what our `parts` row holds
 * (FLEETPAL-INTEGRATION-PLAN.md F12). The FleetPal module builds these; this file writes them.
 */
export interface FleetpalPartCandidate {
  fleetpalId: string;
  partNumber: string;
  description: string;
  unitOfMeasure: UnitOfMeasure;
  /** FleetPal's own word, or null when it recorded none. */
  fleetpalUnit: string | null;
  upc: string | null;
}

export type PartSyncOutcome = "created" | "updated" | "adopted" | "skipped_duplicate_number";

const KEY = "id, part_number, fleetpal_id";

/**
 * Writes one FleetPal part into the catalogue, idempotently (F12; D-FP2: the fleetpal module reaches
 * `parts` only through this maintenance-owned writer).
 *
 * ── THREE WAYS A ROW CAN ALREADY BE HERE ──────────────────────────────────────────────────────
 *   1. By `fleetpal_id` — the usual case on every sweep after the first. Number, description, unit
 *      and barcode are FleetPal's to overwrite, which is how a part RENUMBERED in FleetPal updates in
 *      place (the reason 0525 exists). Manufacturer, category, notes, photo and `active` are the
 *      shop's and are never touched.
 *   2. By number, case-insensitively, on a part the shop typed before the sync — `idx_parts_number`
 *      would refuse a second row, and a second row would split the shelf's history anyway. The
 *      hand-typed part is ADOPTED: it gains the FleetPal id and FleetPal's description and unit.
 *   3. By number on a part that already belongs to a DIFFERENT FleetPal id. Seven numbers on the live
 *      account are carried by two entries each (measured 2026-10-28); the first one in wins and the
 *      second is reported as a duplicate rather than written over the first, because which of the
 *      two the shop means is the shop's question.
 */
export async function syncFleetpalPart(
  admin: SupabaseClient,
  orgId: string,
  c: FleetpalPartCandidate,
): Promise<{ outcome: PartSyncOutcome; partId: string | null } | ServiceError> {
  const vendorFields = {
    part_number: c.partNumber,
    description: c.description,
    unit_of_measure: c.unitOfMeasure,
    fleetpal_unit: c.fleetpalUnit,
    ...(c.upc ? { upc: c.upc } : {}),
  };
  const byId = await admin.from("parts").select(KEY).eq("org_id", orgId).eq("fleetpal_id", c.fleetpalId).maybeSingle();
  if (byId.error) return traced("syncFleetpalPart", "db_error", "Could not look the part up by FleetPal id", byId.error);
  if (byId.data) {
    const { error } = await admin
      .from("parts")
      .update({ ...vendorFields, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", (byId.data as { id: string }).id);
    if (error) return traced("syncFleetpalPart", "db_error", "Could not update the part from FleetPal", error);
    return { outcome: "updated", partId: (byId.data as { id: string }).id };
  }
  // `ilike` with every wildcard escaped is the only exact case-insensitive match PostgREST offers,
  // and it is what `idx_parts_number` (on `lower(part_number)`) will judge the insert by.
  const byNumber = await admin
    .from("parts")
    .select(KEY)
    .eq("org_id", orgId)
    .ilike("part_number", c.partNumber.replace(/[\\%_]/g, (ch) => `\\${ch}`))
    .maybeSingle();
  if (byNumber.error) return traced("syncFleetpalPart", "db_error", "Could not look the part up by number", byNumber.error);
  if (byNumber.data) {
    const found = byNumber.data as { id: string; fleetpal_id: string | null };
    if (found.fleetpal_id && found.fleetpal_id !== c.fleetpalId) return { outcome: "skipped_duplicate_number", partId: found.id };
    const { error } = await admin
      .from("parts")
      .update({ ...vendorFields, fleetpal_id: c.fleetpalId, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", found.id);
    if (error) return traced("syncFleetpalPart", "db_error", "Could not adopt the part from FleetPal", error);
    return { outcome: "adopted", partId: found.id };
  }
  const { data, error } = await admin
    .from("parts")
    .insert({ org_id: orgId, fleetpal_id: c.fleetpalId, ...vendorFields })
    .select("id")
    .single();
  if (error) return traced("syncFleetpalPart", "db_error", "Could not create the part from FleetPal", error);
  return { outcome: "created", partId: (data as { id: string }).id };
}
