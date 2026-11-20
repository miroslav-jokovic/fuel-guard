import { boardStops, loadBoardState, loadRatePerMile } from "@silvicom/shared";
import type { DataTableColumn } from "@silvicom/ui";
import { deliveredCell } from "./loadListFilters";
import { loadEventAt, loadStartedAt } from "./loadListOrder";
import type { DispatchLoad } from "./useDispatchLoads";

/**
 * The Loads list's columns (LR7, the owner's 2026-09-23 list; the order is the page's, see
 * `DispatchLoadsPage.vue`) and what each sorts by. Out of the page so the page stays inside its
 * 500-line budget; nothing here renders.
 */
export const LOAD_COLUMNS: DataTableColumn[] = [
  { key: "ref", label: "Load #", sortable: true, width: "sm", cellClass: "font-medium text-ink", card: "title" },
  { key: "status", label: "Status", sortable: true, width: "md", card: "status" },
  { key: "driver_name", label: "Driver", sortable: true, width: "md", card: "sentence" },
  { key: "pickup", label: "Pickup", sortable: true, width: "lg", card: "figure" },
  { key: "delivery", label: "Delivery", sortable: true, width: "lg", card: "figure" },
  { key: "type", label: "Type", width: "sm", card: "figure" },
  // D-LMR7: whether the office sent it is its own fact, beside McLeod's status — never folded into it.
  { key: "dispatch", label: "Dispatch", width: "md", card: "detail" },
];
/** When the truck left the last drop (D-LA1), beside Delivery's appointment, on the two tabs that hold delivered loads. */
export const DELIVERED_COLUMN: DataTableColumn = { key: "delivered", label: "Delivered", sortable: true, width: "md", card: "figure" };


/**
 * What each load pays (LOAD-RATES-PLAN D-RATE8): the McLeod order's total and its rate per mile, before
 * Dispatch. Only for a reader holding `dispatch.load_rates` (`loadColumns`) — for anyone else the columns do
 * not exist, so the picker does not list them, and the API sends them no `charges` anyway (D-RATE7).
 * Shown by default. A detail on the phone card: Pickup, Delivery and Type are already its three figures.
 * The cells are `LoadRateCell.vue`'s, shared with the board.
 */
export const RATE_COLUMNS: DataTableColumn[] = [
  { key: "rate", label: "Rate", sortable: true, numeric: true, width: "sm", card: "detail" },
  { key: "per_mile", label: "Per mile", sortable: true, numeric: true, width: "sm", card: "detail" },
];
export const RATE_KEYS = ["rate", "per_mile"] as const;

/** The list's columns, in the page's order: Delivered after Delivery on the two windowed tabs, the rates before Dispatch. */
export function loadColumns(windowed: boolean, seesRates: boolean): DataTableColumn[] {
  const base = windowed ? [...LOAD_COLUMNS.slice(0, 5), DELIVERED_COLUMN, ...LOAD_COLUMNS.slice(5)] : LOAD_COLUMNS;
  if (!seesRates) return base;
  const at = base.findIndex((c) => c.key === "dispatch");
  return [...base.slice(0, at), ...RATE_COLUMNS, ...base.slice(at)];
}
/** Every key the URL may sort by. A rate key from a holder's shared link sorts nothing for a non-holder: no row has a price. */
export const LOAD_SORT_KEYS = [...LOAD_COLUMNS, DELIVERED_COLUMN, ...RATE_COLUMNS].filter((c) => c.sortable).map((c) => c.key);

/** What a column — or an opening order's own key (`loadListOrder.ts`), which no header writes — sorts by. */
export function loadSortValue(load: DispatchLoad, key: string, nowMs: number): unknown {
  const { pickup, delivery } = boardStops(load.stops);
  if (key === "pickup") return pickup?.appointment_start ?? null;
  if (key === "delivery") return delivery?.appointment_start ?? null;
  if (key === "status") return loadBoardState(load).label;
  if (key === "delivered") return deliveredCell(load, nowMs).at;
  if (key === "started") return loadStartedAt(load);
  if (key === "event") return loadEventAt(load);
  if (key === "rate") return load.charges?.total_charge ?? null;
  if (key === "per_mile") return load.charges ? loadRatePerMile(load.charges) : null;
  return (load as unknown as Record<string, unknown>)[key];
}
