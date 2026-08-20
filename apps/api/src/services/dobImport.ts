import type { SupabaseClient } from "@supabase/supabase-js";
import { planDobImport, serializeDobCsv, type DobCsvDriver, type DobImportPlan } from "@fuelguard/shared";

/**
 * Bulk date-of-birth import (P0b) — the read, the plan, and the one write.
 *
 * The plan is computed HERE rather than trusted from the client, even though the client computes the
 * same plan to show a preview. The browser's copy is a preview; this one decides. A request that
 * arrived with `[{driverId, dateOfBirth}]` already resolved would let anyone who can call the
 * endpoint write a date of birth onto any driver in their org without a matching row in a file —
 * and the matching is the part with the safety rules in it.
 *
 * Every query org-filters itself: the service role bypasses RLS. Pinned by "scopes every read and
 * the write to the caller's org".
 */

const DRIVER_COLS = "id, full_name, employee_id, cdl_number, date_of_birth";

/** Active and applicant only — the same population the readiness report counts, for the same reason. */
async function rosterFor(admin: SupabaseClient, orgId: string): Promise<DobCsvDriver[]> {
  const { data } = await admin
    .from("drivers")
    .select(DRIVER_COLS)
    .eq("org_id", orgId)
    .in("status", ["active", "applicant"])
    .order("full_name", { ascending: true });
  return (data ?? []) as DobCsvDriver[];
}

/** The template, one row per driver, with `date_of_birth` already filled in where we have it. */
export async function dobCsvTemplate(admin: SupabaseClient, orgId: string): Promise<string> {
  return serializeDobCsv(await rosterFor(admin, orgId));
}

export interface DobImportResult extends DobImportPlan {
  /** Rows the database actually changed. Lower than `matches` when somebody typed one in meanwhile. */
  applied: number;
}

/**
 * Plan the file against the live roster, then apply it.
 *
 * `applied` is reported separately from `matches.length` and the difference is not noise: the RPC
 * updates only where `date_of_birth is null`, so a plan made against a roster read seconds ago
 * silently declines to overwrite anything that changed underneath it. Reporting the matched count as
 * the applied count would tell somebody 40 dates landed when 39 did.
 */
export async function importDriverDob(
  admin: SupabaseClient,
  orgId: string,
  csv: string,
  today: string,
  opts: { dryRun?: boolean } = {},
): Promise<DobImportResult> {
  const plan = planDobImport(csv, await rosterFor(admin, orgId), today);
  if (opts.dryRun || plan.matches.length === 0) return { ...plan, applied: 0 };

  const { data, error } = await admin.rpc("apply_driver_dob", {
    p_org: orgId,
    p_rows: plan.matches.map((m) => ({ driver_id: m.driverId, date_of_birth: m.dateOfBirth })),
  });
  if (error) throw new Error(error.message);
  return { ...plan, applied: Number(data ?? 0) };
}
