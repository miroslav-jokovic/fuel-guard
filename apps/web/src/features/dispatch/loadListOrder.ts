import { boardStops, loadDeliveredAt, loadPickedUpAt } from "@silvicom/shared";
import type { SortState } from "@silvicom/ui";
import type { DispatchLoad } from "./useDispatchLoads";
import type { QueueTab } from "./useDispatchLoads";

/**
 * The order each Loads tab OPENS in, until a header is clicked (DISPATCH-LOADS-COUNTS-PLAN D-DLC4,
 * Q-DLC7; the design contract §5.3 states the rule).
 *
 * Until 2026-10-20 three of the five tabs opened in `loads.created_at` order — when the mirror first
 * saw the load, which is one instant for the hundreds swept on 09/17/2026 and McLeod's own order
 * after — a column nobody can see. The owner: "default sorting is wrong and off-standard; loads must
 * sort latest → oldest in every table." So every tab opens by the ROW'S OWN EVENT TIME:
 *
 *   In transit  — when the truck left the pickup, newest first: the load most recently under way
 *                 leads. A load whose departure McLeod has not keyed sorts last (nulls last).
 *   Upcoming,   — the first pickup's appointment, SOONEST first (Q-DLC7): these are the two tabs whose
 *   Uncovered     event is still ahead, and a dispatcher planning tomorrow reads the nearest one first.
 *   Delivered   — delivered at (D-LA1), newest first, as PR 1652 made it.
 *   All         — whichever of those the row has, newest first: a load's one defining moment.
 *   Exceptions  — its own feed, already newest first; not a loads table.
 *
 * Ties keep the server's order (`listLoads`, created then id), so two loads delivered in the same
 * minute do not swap between polls. The keys `started` and `event` are not columns: a header click
 * writes its own key to the URL and this rule steps aside.
 */
export const OPENING_SORT: Record<Exclude<QueueTab, "exceptions">, SortState> = {
  in_transit: { key: "started", dir: "desc" },
  upcoming: { key: "pickup", dir: "asc" },
  uncovered: { key: "pickup", dir: "asc" },
  delivered: { key: "delivered", dir: "desc" },
  all: { key: "event", dir: "desc" },
};

/** The sort in force: the URL's when a header was clicked, else the tab's own opening order. */
export function listSort(url: SortState, tab: QueueTab): SortState {
  if (url.key || tab === "exceptions") return url;
  return OPENING_SORT[tab];
}

/** When the truck left the pickup — the In transit tab's event (null until McLeod keys it). */
export function loadStartedAt(load: Pick<DispatchLoad, "stops">): string | null {
  return loadPickedUpAt(load.stops);
}

/**
 * The row's one defining moment, for All: delivered at, else when it left the pickup, else the pickup
 * appointment. A delivered load is placed by its delivery even when its pickup is newer than another
 * load's — the question All answers is "what happened latest".
 */
export function loadEventAt(load: Pick<DispatchLoad, "stops" | "status">): string | null {
  if (load.status === "delivered") return loadDeliveredAt(load.stops);
  return loadStartedAt(load) ?? boardStops(load.stops).pickup?.appointment_start ?? null;
}
