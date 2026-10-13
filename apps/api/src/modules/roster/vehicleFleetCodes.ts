import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The TMS's facts about each truck that are not its identity, onto `vehicles`: its home fleet code
 * (`mcleod_fleet_code`, DISPATCH-BOARD-PLAN DB1, 0450) and whether the TMS is winding it down
 * (`winding_down`, D-DB11, 0462). Roster owns `vehicles` (D-ARC3); the facts arrive on mcleod's roster
 * sweep, which calls this through roster's index.
 *
 * ── WHY THEY ARE NOT PART OF THE VEHICLE PATCH ───────────────────────────────────────────────────
 * The roster's identity patch obeys "the office owns this truck's identity" (`skippedOwned`): once a
 * person edits a plate, the sweep stops rewriting make, plate and VIN. Neither fact is identity. The
 * fleet is which dispatcher's group the truck belongs to in McLeod this week; winding down is McLeod
 * saying the truck is on its way out. The office editing a plate does not make McLeod wrong about
 * either — the reasoning that records the fuel-tax exclusion (0433) for every placed truck. So the
 * caller passes every truck the sweep PLACED, owned or not.
 *
 * ── WRITE ONLY ON CHANGE ─────────────────────────────────────────────────────────────────────────
 * The sweep runs every two minutes on the Board VM, and these facts change a few times a week. Writing
 * every placed truck every sweep would bump `updated_at` on rows whose only news is "nothing", and
 * `updated_at` is what other readers use to ask whether a truck changed. So the current values are read
 * first and only trucks whose value moved are written, one UPDATE per new value.
 *
 * Service role: the `.eq("org_id", …)` on every statement is the only tenant boundary.
 */

export interface FleetPlacement {
  vehicleId: string;
  /** The TMS's code, trimmed by the agent; null = the TMS puts this truck in no fleet. */
  code: string | null;
}

export interface WindingDownPlacement {
  vehicleId: string;
  windingDown: boolean;
}

/** PostgREST puts `.in()` lists in the URL; Node 22 refuses headers past ~16 KB. 100 uuids is ~3.7 KB. */
const CHUNK = 100;
const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

type FactColumn = "mcleod_fleet_code" | "winding_down";

/** Read the column for these trucks, write each one whose value moved. Returns how many were written. */
async function recordOnChange<T extends string | boolean | null>(
  admin: SupabaseClient,
  orgId: string,
  column: FactColumn,
  wanted: Map<string, T>,
): Promise<number> {
  if (wanted.size === 0) return 0;
  const current = new Map<string, T | null>();
  for (const ids of chunks([...wanted.keys()])) {
    const { data, error } = await admin
      .from("vehicles")
      .select(`id, ${column}`)
      .eq("org_id", orgId)
      .in("id", ids);
    if (error) throw new Error(`vehicles ${column} read failed: ${error.message}`);
    for (const v of (data ?? []) as unknown as Array<Record<string, unknown> & { id: string }>) {
      current.set(v.id, (v[column] ?? null) as T | null);
    }
  }

  // Only trucks the read returned are written: an id it did not return is not this org's truck.
  const byValue = new Map<T, string[]>();
  for (const [id, value] of wanted) {
    if (!current.has(id) || current.get(id) === value) continue;
    byValue.set(value, [...(byValue.get(value) ?? []), id]);
  }
  let changed = 0;
  for (const [value, ids] of byValue) {
    for (const part of chunks(ids)) {
      const { error } = await admin
        .from("vehicles")
        .update({ [column]: value })
        .eq("org_id", orgId)
        .in("id", part);
      if (error) throw new Error(`vehicles ${column} update failed: ${error.message}`);
      changed += part.length;
    }
  }
  return changed;
}

/** Returns how many trucks changed fleet — zero on almost every sweep. */
export async function recordVehicleFleetCodes(
  admin: SupabaseClient,
  orgId: string,
  placements: FleetPlacement[],
): Promise<number> {
  return recordOnChange(admin, orgId, "mcleod_fleet_code", new Map(placements.map((p) => [p.vehicleId, p.code])));
}

/**
 * Returns how many trucks started or stopped winding down. A null column (never reported) and a
 * reported `false` differ on purpose, so the first sweep after 0462 records `false` on every running
 * truck once: from then on "not winding down" is McLeod's answer rather than our silence.
 */
export async function recordVehicleWindingDown(
  admin: SupabaseClient,
  orgId: string,
  placements: WindingDownPlacement[],
): Promise<number> {
  return recordOnChange(admin, orgId, "winding_down", new Map(placements.map((p) => [p.vehicleId, p.windingDown])));
}
