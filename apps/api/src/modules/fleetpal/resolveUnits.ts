import type { SupabaseClient } from "@supabase/supabase-js";
import { listEquipmentIdentities } from "../roster/index.js";
import { listUnits, setMatch, type FleetpalUnitRow } from "./units.js";
import { matchFleetpalUnit, type Roster, type UnitMatch } from "./unitMatch.js";

/**
 * Apply the matcher to everything staged (FLEETPAL-INTEGRATION-PLAN.md F5, D-FP2, D-FP7).
 *
 * `unitMatch.ts` decides and this file fetches, compares and writes — the seam that lets every
 * interesting case be a three-line fixture instead of a database.
 *
 * ── THE ROSTER IS READ THROUGH ITS OWNING MODULE, INCLUDING RETIRED EQUIPMENT ─────────────────
 * `listEquipmentIdentities` is roster's own door (D-FP2); this module never says `.from("vehicles")`.
 * It asks for `activeOnly: false` on purpose: **a truck sold in June still owns the repairs it had
 * in May.** Matching only the active fleet would quietly orphan the history of every unit that left
 * — measured 2026-09-21, that is 37 retired vehicles and 24 retired trailers, and 36 of the 474
 * FleetPal units match by VIN only once retired rows are in the candidate set.
 *
 * ── ⚠ A MANUAL LINK IS NEVER OVERWRITTEN ──────────────────────────────────────────────────────
 * `match_method='manual'` is a person's answer to a question this code could not answer. Re-running
 * the resolver must not undo it, once a night, invisibly — the same failure `stageUnit` avoids by
 * omitting the match columns from the vendor's patch. The only thing that clears a manual link is
 * somebody unlinking it.
 */

export interface ResolveOutcome {
  examined: number;
  /** Rows whose resolution CHANGED. A steady state resolves nothing, which is the point. */
  updated: number;
  matchedByVin: number;
  matchedByNumber: number;
  stillUnmatched: number;
  /** Manual links left alone. Reported so "nothing happened" has a visible reason. */
  manualPreserved: number;
  errors: string[];
}

async function readRoster(admin: SupabaseClient, orgId: string): Promise<Roster | { error: string }> {
  const vehicles = await listEquipmentIdentities(admin, orgId, "tractor", { activeOnly: false });
  if ("error" in vehicles) return { error: vehicles.error };
  const trailers = await listEquipmentIdentities(admin, orgId, "trailer", { activeOnly: false });
  if ("error" in trailers) return { error: trailers.error };
  return {
    vehicles: vehicles.map((v) => ({ id: v.id, unitNumber: v.unitNumber, vin: v.vin })),
    trailers: trailers.map((t) => ({ id: t.id, unitNumber: t.unitNumber, vin: t.vin })),
  };
}

/** Would writing this resolution change anything? A no-op UPDATE is still a write to audit and lock. */
function differs(row: FleetpalUnitRow, match: UnitMatch): boolean {
  return (
    row.matchMethod !== match.method ||
    row.vehicleId !== match.vehicleId ||
    row.trailerId !== match.trailerId
  );
}

export async function resolveStagedUnits(
  admin: SupabaseClient,
  orgId: string,
): Promise<ResolveOutcome | { error: string }> {
  const roster = await readRoster(admin, orgId);
  if ("error" in roster) return roster;

  const rows = await listUnits(admin, orgId);
  const outcome: ResolveOutcome = {
    examined: rows.length,
    updated: 0,
    matchedByVin: 0,
    matchedByNumber: 0,
    stillUnmatched: 0,
    manualPreserved: 0,
    errors: [],
  };

  for (const row of rows) {
    if (row.matchMethod === "manual") {
      outcome.manualPreserved++;
      continue;
    }
    const match = matchFleetpalUnit({ vin: row.vin, number: row.number }, roster);
    if (match.method === "vin") outcome.matchedByVin++;
    else if (match.method === "number") outcome.matchedByNumber++;
    else outcome.stillUnmatched++;

    if (!differs(row, match)) continue;
    const written =
      match.method === "unmatched"
        ? await setMatch(admin, orgId, row.fleetpalId, { method: "unmatched" })
        : match.vehicleId !== null
          ? await setMatch(admin, orgId, row.fleetpalId, { method: match.method, vehicleId: match.vehicleId })
          : await setMatch(admin, orgId, row.fleetpalId, { method: match.method, trailerId: match.trailerId! });
    if ("error" in written) outcome.errors.push(`${row.fleetpalId}: ${written.error}`);
    else outcome.updated++;
  }

  return outcome;
}
