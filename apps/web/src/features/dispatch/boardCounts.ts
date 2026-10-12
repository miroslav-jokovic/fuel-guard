import type { DispatchBoardResponse, DispatchBoardRow } from "@silvicom/shared";
import { BOARD_QUEUES, filterBoard, type BoardFilter, type BoardQueue } from "./dispatchBoardView";

/**
 * The Operations tab's dispatch counts, asked of the board's OWN filter (FLEET-MANAGER-HOME-PLAN D-FM7).
 *
 * `filterBoard` with scope All and no search is exactly what `/assignments?scope=all&queue=…` shows,
 * parked pool excluded and all — so "Late risk 4" on the card is the row count behind its door. A
 * count written here as `rows.filter((r) => r.flags.lateRisk)` would have been one line shorter and
 * would have counted the pool's trucks the board hides; that is the drift this file exists to rule out.
 *
 * Scope is ALL and not the caller's own: a fleet manager is no McLeod dispatcher, and an admin who is
 * one is still reading the whole fleet on this tab. The door says `scope=all` so the board agrees even
 * for a linked caller whose board would otherwise open on My fleet.
 */
const ALL: BoardFilter = { queue: "all", search: "", mine: false, fleet: "", dispatcher: "" };

export const boardRows = (board: DispatchBoardResponse, queue: BoardQueue = "all"): DispatchBoardRow[] =>
  filterBoard(board.rows, board.scope, { ...ALL, queue });

export const boardDoor = (queue: BoardQueue = "all"): string =>
  queue === "all" ? "/assignments?scope=all" : `/assignments?scope=all&queue=${queue}`;

/** The board's own label for a queue, so the card and the board's tab say the same words. */
export const queueLabel = (queue: BoardQueue): string => BOARD_QUEUES.find((q) => q.value === queue)!.label;

/**
 * What every truck on the board is doing: hauling, empty, or in the shop. A partition — every row is
 * exactly one — because `emptyNow` and `inShop` are already disjoint by `boardFlags`'s rule (a truck
 * in the shop is "not available", never "empty").
 */
export function fleetNow(board: DispatchBoardResponse): { total: number; loaded: number; empty: number; inShop: number } {
  const rows = boardRows(board);
  const inShop = rows.filter((r) => r.inShop).length;
  const empty = rows.filter((r) => r.flags.emptyNow).length;
  return { total: rows.length, loaded: rows.length - inShop - empty, empty, inShop };
}
