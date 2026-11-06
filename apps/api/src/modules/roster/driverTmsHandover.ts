import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Hand an application row to the TMS that hired the person (ROSTER-LIFECYCLE-PLAN D-RL5, 2026-11-06).
 *
 * Roster owns `drivers` (D-ARC3), so the write lives here and `mcleod`'s sweep, which decides THAT the
 * McLeod driver is this applicant (`rosterApplicantHire`), calls through the interface — the shape
 * `restoreRehiredDriver` gives the rehire.
 *
 * Two facts in one write: the McLeod link, and `identity_source = 'mcleod'`. An application row is
 * `'manual'` because the applicant typed it, and the sweep stands off a `'manual'` row entirely — so
 * without the hand-over the hired driver would be linked once and never refreshed from McLeod again,
 * the system the carrier keeps its roster in (`roster_master`).
 *
 * Returns false when the database refuses — a 23505 from 0239's unique index means another row already
 * claims this McLeod id, and the caller leaves the driver held rather than failing the sweep.
 */
export async function handApplicationToTms(
  admin: SupabaseClient,
  orgId: string,
  facts: { driverId: string; externalId: string; companyId: string | null },
): Promise<boolean> {
  const { error } = await admin
    .from("drivers")
    .update({ mcleod_driver_id: facts.externalId, mcleod_company_id: facts.companyId, identity_source: "mcleod" })
    .eq("id", facts.driverId)
    .eq("org_id", orgId)
    .eq("status", "applicant");
  return !error;
}
