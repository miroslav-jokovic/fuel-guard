import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Each truck's home fleet code from the TMS, onto `vehicles.mcleod_fleet_code` (DISPATCH-BOARD-PLAN.md
 * DB1, 0450). Roster owns `vehicles` (D-ARC3); the code arrives on mcleod's roster sweep, which calls
 * this through roster's index.
 *
 * ── WHY IT IS NOT PART OF THE VEHICLE PATCH ──────────────────────────────────────────────────────
 * The roster's identity patch obeys "the office owns this truck's identity" (`skippedOwned`): once a
 * person edits a plate, the sweep stops rewriting make, plate and VIN. The fleet is not identity. It is
 * which dispatcher's group the truck belongs to in McLeod this week, and the office editing a plate
 * does not make McLeod wrong about it — the reasoning that records the fuel-tax exclusion (0433) for
 * every placed truck. So the caller passes every truck the sweep PLACED, owned or not.
 *
 * ── WRITE ONLY ON CHANGE ─────────────────────────────────────────────────────────────────────────
 * The sweep runs every two minutes on the Board VM, and a fleet changes a few times a week. Writing
 * every placed truck every sweep would bump `updated_at` on rows whose only news is "nothing", and
 * `updated_at` is what other readers use to ask whether a truck changed. So the current codes are read
 * first and only trucks whose code moved are written, one UPDATE per new code.
 *
 * Service role: the `.eq("org_id", …)` on every statement is the only tenant boundary.
 */

export interface FleetPlacement {
  vehicleId: string;
  /** The TMS's code, trimmed by the agent; null = the TMS puts this truck in no fleet. */
  code: string | null;
}

/** PostgREST puts `.in()` lists in the URL; Node 22 refuses headers past ~16 KB. 100 uuids is ~3.7 KB. */
const CHUNK = 100;
const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

/** Returns how many trucks changed fleet — zero on almost every sweep. */
export async function recordVehicleFleetCodes(
  admin: SupabaseClient,
  orgId: string,
  placements: FleetPlacement[],
): Promise<number> {
  if (placements.length === 0) return 0;
  const wanted = new Map(placements.map((p) => [p.vehicleId, p.code]));

  const current = new Map<string, string | null>();
  for (const ids of chunks([...wanted.keys()])) {
    const { data, error } = await admin
      .from("vehicles")
      .select("id, mcleod_fleet_code")
      .eq("org_id", orgId)
      .in("id", ids);
    if (error) throw new Error(`vehicles fleet read failed: ${error.message}`);
    for (const v of (data ?? []) as Array<{ id: string; mcleod_fleet_code: string | null }>) {
      current.set(v.id, v.mcleod_fleet_code);
    }
  }

  // Only trucks the read returned are written: an id it did not return is not this org's truck.
  const byCode = new Map<string | null, string[]>();
  for (const [id, code] of wanted) {
    if (!current.has(id) || current.get(id) === code) continue;
    byCode.set(code, [...(byCode.get(code) ?? []), id]);
  }
  let changed = 0;
  for (const [code, ids] of byCode) {
    for (const part of chunks(ids)) {
      const { error } = await admin
        .from("vehicles")
        .update({ mcleod_fleet_code: code })
        .eq("org_id", orgId)
        .in("id", part);
      if (error) throw new Error(`vehicles fleet update failed: ${error.message}`);
      changed += part.length;
    }
  }
  return changed;
}
