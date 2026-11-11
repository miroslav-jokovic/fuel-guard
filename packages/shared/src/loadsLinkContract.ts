import type { LoadBoardQueue } from "./loadBoard.js";

/**
 * The Loads page's URL (`/dispatch/loads`), as ONE definition read by the page and by Ask AI's
 * `loads_by_truck` link (F21 R4b, D-AI6). See `fuelCostsLinkContract.ts` for why a query string gets
 * a contract.
 *
 * ── THE THREE WAYS A HAND-BUILT LINK GOES WRONG HERE ──────────────────────────────────────────────
 *  · The delivered window is two INCLUSIVE carrier days (`delivered_from`, `delivered_to`), the
 *    picker's. The API under it takes instants with an EXCLUSIVE end (`delivered_before`); a link
 *    that copied the API's form would open a day long, or a day short.
 *  · `truck` and `driver` are ONE id each, not unit numbers and not lists: the page's filters match
 *    exactly one id (D-LA2). A link for several trucks leaves `truck` out and the page shows them all,
 *    which is the list the answer counted; its Truck filter names each with its count.
 *  · `scope`: a dispatcher linked to fleets opens on THEIR loads ("mine") by default (D-DB3). The tool
 *    counts the whole fleet, so its link says `scope=all`, or a dispatcher would see fewer loads than
 *    the answer gave and no reason why. The dispatch board shares this key (`useScopeChoice`).
 */
export const LOADS_QUERY_KEYS = {
  queue: "queue",
  deliveredFrom: "delivered_from",
  deliveredTo: "delivered_to",
  truck: "truck",
  driver: "driver",
  scope: "scope",
} as const;

export interface LoadsLinkFilters {
  queue?: LoadBoardQueue;
  deliveredFrom?: string;
  deliveredTo?: string;
  vehicleId?: string | null;
  driverId?: string | null;
  scope?: "mine" | "all";
}

/** The page's query for these filters; what is not given is left out, so the page's default holds. */
export function loadsToQuery(f: LoadsLinkFilters): Record<string, string> {
  const K = LOADS_QUERY_KEYS;
  const q: Record<string, string> = {};
  if (f.queue) q[K.queue] = f.queue;
  if (f.deliveredFrom) q[K.deliveredFrom] = f.deliveredFrom;
  if (f.deliveredTo) q[K.deliveredTo] = f.deliveredTo;
  if (f.vehicleId) q[K.truck] = f.vehicleId;
  if (f.driverId) q[K.driver] = f.driverId;
  if (f.scope) q[K.scope] = f.scope;
  return q;
}
