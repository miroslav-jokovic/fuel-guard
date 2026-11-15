import { boardStops, loadBoardState } from "@silvicom/shared";
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

/** What a column — or an opening order's own key (`loadListOrder.ts`), which no header writes — sorts by. */
export function loadSortValue(load: DispatchLoad, key: string, nowMs: number): unknown {
  const { pickup, delivery } = boardStops(load.stops);
  if (key === "pickup") return pickup?.appointment_start ?? null;
  if (key === "delivery") return delivery?.appointment_start ?? null;
  if (key === "status") return loadBoardState(load).label;
  if (key === "delivered") return deliveredCell(load, nowMs).at;
  if (key === "started") return loadStartedAt(load);
  if (key === "event") return loadEventAt(load);
  return (load as unknown as Record<string, unknown>)[key];
}
