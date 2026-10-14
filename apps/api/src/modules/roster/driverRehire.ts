import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "../../lib/audit.js";

/**
 * Restore a former driver the TMS has rehired (MCLEOD-ROSTER-SYNC-PLAN D-MR7a, owner 2026-10-14).
 *
 * Roster owns `drivers` (D-ARC3), so the write lives here and `mcleod`'s sweep, which decides WHETHER a
 * rehire is proven (`rosterDriverSettle`), calls through the interface — the shape `vehicleFleetCodes`
 * gives the TMS's truck facts.
 *
 * The inverse of what the reconcile run does to a leaver: status back to `active`, unarchived, and the
 * termination date cleared. Clearing it protects the §391.51(c) clock rather than erasing it — the old
 * date goes into the audit row, and `rosterRetire` never moves a date already set, so keeping it would
 * start the clock at the FIRST termination when the driver leaves again.
 */
export interface RehireFacts {
  driverId: string;
  externalId: string;
  tmsHireDate: string;
  previousTerminationDate: string;
  previousStatus: string | null;
  wasArchived: boolean;
}

export async function restoreRehiredDriver(admin: SupabaseClient, orgId: string, facts: RehireFacts): Promise<void> {
  const { error } = await admin
    .from("drivers")
    .update({ status: "active", archived_at: null, termination_date: null })
    .eq("id", facts.driverId)
    .eq("org_id", orgId);
  if (error) throw new Error(error.message);
  const { driverId, ...meta } = facts;
  const recorded = await writeAudit(admin, {
    orgId,
    actorId: null,
    action: "driver.rehired_from_tms",
    entity: "drivers",
    entityId: driverId,
    meta: { ...meta, source: "mcleod_active_roster" },
  });
  if (!recorded) throw new Error(`Could not audit the rehire of ${facts.externalId}`);
}
