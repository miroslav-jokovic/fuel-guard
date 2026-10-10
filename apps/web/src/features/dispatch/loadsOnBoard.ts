import type { DispatchBoardResponse, OnTimeVerdict } from "@silvicom/shared";
import type { ScopedItem } from "./dispatchScope";

/**
 * What the Loads page reads off the Dispatch board for one load (DISPATCH-BOARD-PLAN §5.3, DB5b): the
 * fleet of the truck it is on — so My fleet and the Fleet filter mean on Loads what they mean on the
 * board — and, for the load a truck is hauling now, the board's on-time verdict.
 *
 * ⚠ The verdict is READ, never recomputed. It needs the truck's position and HOS clocks, which only
 * the board composes (`onTimeVerdict` in `@silvicom/shared`, over the board's own ETA); computing it
 * again here from a list that has neither would be the second answer D-DB4 rules out. So a load gets
 * a badge exactly when it is some truck's current load on the board, and none otherwise: an upcoming
 * load has no ETA yet, and saying "unknown" on every one of them would be noise, not a fact.
 */
type Board = Pick<DispatchBoardResponse, "rows"> | null | undefined;

export interface LoadsOnBoard {
  /** The scope shape `admitsScope` judges, for one load. */
  scopeItem(load: { vehicle_id: string | null; dispatcher_external_id?: string | null }): ScopedItem;
  /** The board's verdict for a load some truck is hauling now; null for any other load. */
  onTimeOf(loadId: string): OnTimeVerdict | null;
}

export function loadsOnBoard(board: Board): LoadsOnBoard {
  const fleetByVehicle = new Map<string, string | null>();
  const onTimeByLoad = new Map<string, OnTimeVerdict>();
  for (const r of board?.rows ?? []) {
    fleetByVehicle.set(r.vehicleId, r.fleetCode);
    if (r.current) onTimeByLoad.set(r.current.loadId, r.onTime);
  }
  return {
    scopeItem: (load) => ({
      fleetCode: load.vehicle_id ? (fleetByVehicle.get(load.vehicle_id) ?? null) : null,
      current: { dispatcherId: load.dispatcher_external_id ?? null },
      next: null,
    }),
    onTimeOf: (loadId) => onTimeByLoad.get(loadId) ?? null,
  };
}
