/**
 * The typed roadside record, recomputed from the raw feed (INSPECTION-CHALLENGE-PLAN IC1b, 0458).
 *
 * One call to `roadside_project` rebuilds `roadside_inspections`, `_units`, `_violations` and
 * `_citations` for one org from the current `fmcsa_raw_rows` versions, matching each unit to a vehicle
 * or trailer (D-IC7). Set-based in SQL because the unit file alone is ~2,800 rows and PostgREST caps a
 * response at 1,000. Idempotent: a call with nothing new changes no row (measured 2026-10-11 in PGlite on the
 * real record: 1,390 / 2,763 / 1,422 / 21 rows on the first call, 0 / 0 / 0 / 0 on the second).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProjectionCounts {
  /** Rows each table gained or changed on this call. */
  inspections: number;
  units: number;
  violations: number;
  citations: number;
}

export async function projectRoadside(admin: SupabaseClient, orgId: string): Promise<ProjectionCounts> {
  const { data, error } = await admin.rpc("roadside_project", { p_org: orgId });
  if (error) throw new Error(`roadside_project: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!r) throw new Error("roadside_project: no counts returned");
  return {
    inspections: Number(r.inspections),
    units: Number(r.units),
    violations: Number(r.violations),
    citations: Number(r.citations),
  };
}
