import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatcherLabel, type DrawDispatch } from "@silvicom/shared";
import { readFleetDispatchers } from "../mcleod/index.js";
import { readBoardRows } from "./dispatchBoard.js";

/**
 * Who dispatches each driver, read off the dispatch board's own rows (MEDSTOP-PLAN §7A.19).
 *
 * Safety's random-draw list asks it so the DER knows whom to call to take a drawn driver off the
 * road. It is the board's composition and not a second one — the roster's driver-to-truck pairing,
 * the truck's McLeod fleet, the load on it — so "who dispatches Ana" has one answer on both pages.
 * A driver who holds no truck the board shows (none assigned, retired, or winding down with no load)
 * is absent: nobody dispatches them.
 */
export async function readDriverDispatch(
  admin: SupabaseClient,
  orgId: string,
  now: Date = new Date(),
): Promise<Map<string, DrawDispatch>> {
  const board = await readBoardRows(admin, orgId, now);
  const { fleets } = await readFleetDispatchers(admin, orgId);
  const fleetDispatcherOf = new Map(fleets.map((f) => [f.code, f.dispatcherId]));
  // The dispatch screens' name for a dispatcher, in capitals (`dispatcherLabel`), so the DER reads
  // the name the board prints.
  const nameOf = (id: string | null | undefined) => dispatcherLabel(id, fleets) || null;

  const out = new Map<string, DrawDispatch>();
  for (const row of board.rows) {
    if (!row.driver) continue;
    out.set(row.driver.id, {
      unitNumber: row.unitNumber,
      fleetCode: row.fleetCode,
      fleetDispatcher: nameOf(row.fleetCode ? fleetDispatcherOf.get(row.fleetCode) : null),
      loadDispatcher: nameOf(row.current?.dispatcherId),
    });
  }
  return out;
}
