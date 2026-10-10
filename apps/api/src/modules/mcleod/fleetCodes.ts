import type { SupabaseClient } from "@supabase/supabase-js";
import { recordVehicleFleetCodes, type FleetPlacement } from "../roster/index.js";

/**
 * The roster sweep's fleet step (DISPATCH-BOARD-PLAN.md DB1/DB2, 0450): each truck's McLeod home fleet
 * onto the truck — through roster, which owns `vehicles` — and every code seen into mcleod's own
 * `tms_fleets`, so the settings card can list it.
 *
 * ── `tms_fleets` IS SEEDED, NEVER LINKED, HERE ───────────────────────────────────────────────────
 * Whose fleet a code is (`dispatcher_external_id`) is an office's confirmation, and the feed never
 * writes it — D-LM4's rule for `tms_dispatchers.user_id`, extended to fleets. Insert-or-skip with the
 * complete row: org, provider and code are the table's identity and its only required columns.
 *
 * Service role: the `.eq("org_id", …)` / org-carrying payload on every statement is the tenant boundary.
 */
export type { FleetPlacement };

/** Returns how many trucks changed fleet this sweep. */
export async function recordFleetCodes(
  admin: SupabaseClient,
  orgId: string,
  provider: string,
  placements: FleetPlacement[],
): Promise<number> {
  if (placements.length === 0) return 0;
  const changed = await recordVehicleFleetCodes(admin, orgId, placements);
  const codes = [...new Set(placements.map((p) => p.code).filter((c): c is string => c !== null))].sort();
  if (codes.length > 0) {
    const { error } = await admin
      .from("tms_fleets")
      .upsert(
        codes.map((code) => ({ org_id: orgId, provider, code })),
        { onConflict: "org_id,provider,code", ignoreDuplicates: true },
      );
    if (error) throw new Error(`tms_fleets seed failed: ${error.message}`);
  }
  return changed;
}
