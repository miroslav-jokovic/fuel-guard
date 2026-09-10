import type { SupabaseClient } from "@supabase/supabase-js";
import type { FleetpalUnit } from "@silvicom/shared";

/**
 * FleetPal units, and how each resolves to one of our vehicles or trailers
 * (FLEETPAL-INTEGRATION-PLAN.md F2, D-FP7, D-FP14).
 *
 * ── THE MAPPING LIVES HERE, NOT ON THE ROSTER ──────────────────────────────────────────────────
 * `fleetpal_units` carries `vehicle_id` / `trailer_id` rather than `vehicles` carrying a
 * `fleetpal_unit_id`. Roster ownership stays intact — the roster module remains the only writer of
 * its own tables (D-FP2) — and an UNMATCHED unit becomes a visible ROW rather than a missing join.
 * Measured 2026-09-10: 200 of 207 active tractors and 228 of 234 active trailers carry a VIN, so
 * thirteen units resolve by number or not at all. Thirteen rows a person can see is an afternoon's
 * reconciliation; thirteen silent non-joins is a cost report quietly missing trucks.
 *
 * ── ⚠ THIS FILE STAGES AND READS. IT DOES NOT MATCH. ───────────────────────────────────────────
 * The matcher is F5, and it is a PURE function taking the staged unit and our roster and returning
 * a resolution. Keeping the decision out of the store is what lets it be tested against a VIN that
 * differs only in case, a unit number that collides between a tractor and a trailer, and a unit
 * that matches nothing — none of which needs a database.
 *
 * ── AND IT NEVER WRITES A VMRS DESCRIPTION (D-FP8) ─────────────────────────────────────────────
 * `vmrs_equipment_category` is staged as the vendor's opaque id and nothing else. The English
 * behind it is licensed TMC material, resolved at display time and dropped.
 */

export interface FleetpalUnitRow {
  id: string;
  fleetpalId: string;
  number: string | null;
  vin: string | null;
  name: string | null;
  archivedAt: string | null;
  vehicleId: string | null;
  trailerId: string | null;
  matchMethod: "vin" | "number" | "manual" | "unmatched";
  matchedAt: string | null;
}

interface DbRow {
  id: string;
  fleetpal_id: string;
  number: string | null;
  vin: string | null;
  name: string | null;
  archived_at: string | null;
  vehicle_id: string | null;
  trailer_id: string | null;
  match_method: FleetpalUnitRow["matchMethod"];
  matched_at: string | null;
}

const SELECT = "id, fleetpal_id, number, vin, name, archived_at, vehicle_id, trailer_id, match_method, matched_at";

const toRow = (r: DbRow): FleetpalUnitRow => ({
  id: r.id,
  fleetpalId: r.fleetpal_id,
  number: r.number,
  vin: r.vin,
  name: r.name,
  archivedAt: r.archived_at,
  vehicleId: r.vehicle_id,
  trailerId: r.trailer_id,
  matchMethod: r.match_method,
  matchedAt: r.matched_at,
});

export async function listUnits(admin: SupabaseClient, orgId: string): Promise<FleetpalUnitRow[]> {
  const { data, error } = await admin
    .from("fleetpal_units")
    .select(SELECT)
    .eq("org_id", orgId)
    .order("number");
  if (error || !data) return [];
  return (data as DbRow[]).map(toRow);
}

/**
 * D-FP14's number: how many of the vendor's units resolve to nothing of ours.
 *
 * Every read model that prints per-unit cost reports this alongside, because a cost report whose
 * denominator quietly excludes unmatched trucks is the plausible-but-wrong figure D-FIN10 refuses.
 * It is a `count` and not a `select().length`: PostgREST caps every response at 1,000 rows, so
 * counting a fetched page would under-report a fleet the moment it grew past one.
 */
export async function countUnmatched(admin: SupabaseClient, orgId: string): Promise<number> {
  const { count, error } = await admin
    .from("fleetpal_units")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("match_method", "unmatched");
  if (error) return 0;
  return count ?? 0;
}

/**
 * Stage one unit as the vendor sent it, leaving any existing resolution alone.
 *
 * ⚠ **The patch deliberately omits `vehicle_id`, `trailer_id`, `match_method` and `matched_at`.**
 * Those are OURS, not the vendor's, and a sweep that re-sent the vendor's fields along with a
 * default `match_method` would silently unmatch every unit a person had linked by hand — once a
 * night, invisibly, and the only symptom would be a per-unit cost report that got emptier.
 *
 * UPDATE-then-INSERT, never `.upsert()` with a partial payload (`lint:upserts`): `fleetpal_id` is
 * NOT NULL and Postgres checks NOT NULL before it arbitrates the conflict.
 */
export async function stageUnit(
  admin: SupabaseClient,
  orgId: string,
  unit: FleetpalUnit,
): Promise<{ ok: true } | { error: string }> {
  const patch = {
    number: unit.number || null,
    vin: unit.vin || null,
    name: unit.name || null,
    ownership: unit.ownership || null,
    model: unit.model || null,
    model_year: unit.model_year,
    vmrs_equipment_category: unit.vmrs_equipment_category,
    archived_at: unit.archived,
    vendor_updated_at: unit.updated,
  };

  const { data, error } = await admin
    .from("fleetpal_units")
    .update(patch)
    .eq("org_id", orgId)
    .eq("fleetpal_id", unit.id)
    .select("id");
  if (error) return { error: error.message };
  if (data && data.length > 0) return { ok: true };

  const { error: insertError } = await admin
    .from("fleetpal_units")
    .insert({ org_id: orgId, fleetpal_id: unit.id, ...patch });
  if (insertError) return { error: insertError.message };
  return { ok: true };
}

/**
 * Record a resolution. `vehicleId` and `trailerId` are mutually exclusive and the database enforces
 * it (`fleetpal_units_one_side`), as it enforces that a method and a match agree in both directions
 * (`fleetpal_units_match_agrees`) and that the equipment belongs to this org (IV012,
 * `guard_fleetpal_unit_match`). Nothing here re-checks any of that: three copies of a rule is how
 * two of them go stale.
 */
export async function setMatch(
  admin: SupabaseClient,
  orgId: string,
  fleetpalId: string,
  match:
    | { method: "vin" | "number" | "manual"; vehicleId: string; trailerId?: undefined }
    | { method: "vin" | "number" | "manual"; trailerId: string; vehicleId?: undefined }
    | { method: "unmatched" },
): Promise<{ ok: true } | { error: string }> {
  const patch =
    match.method === "unmatched"
      ? { vehicle_id: null, trailer_id: null, match_method: "unmatched", matched_at: null }
      : {
          vehicle_id: match.vehicleId ?? null,
          trailer_id: match.trailerId ?? null,
          match_method: match.method,
          matched_at: new Date().toISOString(),
        };

  const { error } = await admin
    .from("fleetpal_units")
    .update(patch)
    .eq("org_id", orgId)
    .eq("fleetpal_id", fleetpalId);
  if (error) return { error: error.message };
  return { ok: true };
}
