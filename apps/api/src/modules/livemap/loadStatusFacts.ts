import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDisplayDateTime, isLoadOnTruck, type BrokerMailLoadFacts, type DispatchBoardLoad, type DispatchBoardRow } from "@silvicom/shared";
import { readBoardRows } from "./dispatchBoard.js";

/**
 * One load's status as the Dispatch board shows it, for a broker-mail reply draft
 * (BROKER-MAIL-READER-PLAN D-BMR11). It is the board's composition and not a second one — the truck,
 * trailer, last GPS place, next stop, ETA and miles are read off `readBoardRows`, the same rows the
 * board and its ETA recorder use (the pattern `readDriverDispatch` set) — so a broker is never told a
 * different ETA from the one the dispatcher is looking at.
 *
 * A load the board does not show on any truck (delivered, not dispatched yet, a planned next load)
 * answers null: the caller says what it knows from the load itself and that no live position exists.
 * Times are written on the carrier's clock, as the draft will state them.
 */
const kindOf = (k: string | null): "pickup" | "delivery" | "stop" => (k === "pickup" ? "pickup" : k === "dropoff" || k === "delivery" ? "delivery" : "stop");

export function factsFromRow(row: DispatchBoardRow, load: DispatchBoardLoad, isCurrent: boolean, zone: string, builtAt: Date): BrokerMailLoadFacts {
  const s = isCurrent ? load.nextStop : null;
  const clock = (iso: string) => formatDisplayDateTime(iso, "", zone);
  return {
    loadRef: load.ref,
    customerName: load.customerName,
    status: load.externalStatus ?? load.status,
    inMcleod: load.source === "tms",
    accepted: isLoadOnTruck({ status: load.status, source: load.source }),
    truckUnit: row.unitNumber ?? null,
    trailerUnit: load.trailerUnit,
    location: isCurrent && row.position?.place ? { place: row.position.place, ageMinutes: Math.floor((row.position.ageSeconds ?? 0) / 60) } : null,
    nextStop: s ? {
      kind: kindOf(s.kind),
      city: s.city,
      state: s.state,
      appointment: s.appointmentStart ? clock(s.appointmentStart) : null,
      arrived: s.arrivedAt !== null,
    } : null,
    eta: isCurrent && row.eta ? { at: clock(row.eta.at), computedAt: builtAt.toISOString() } : null,
    milesToNextStop: isCurrent && row.eta ? Math.round(row.eta.miles) : null,
    onTime: isCurrent ? row.onTime ?? null : null,
  };
}

export async function readLoadStatusFacts(
  admin: SupabaseClient,
  orgId: string,
  loadIds: readonly string[],
  zone: string,
  now: Date = new Date(),
): Promise<Map<string, BrokerMailLoadFacts>> {
  const out = new Map<string, BrokerMailLoadFacts>();
  if (loadIds.length === 0) return out;
  const want = new Set(loadIds);
  const board = await readBoardRows(admin, orgId, now);
  for (const row of board.rows) {
    if (row.current && want.has(row.current.loadId)) out.set(row.current.loadId, factsFromRow(row, row.current, true, zone, now));
    if (row.next && want.has(row.next.loadId) && !out.has(row.next.loadId)) out.set(row.next.loadId, factsFromRow(row, row.next, false, zone, now));
  }
  return out;
}
