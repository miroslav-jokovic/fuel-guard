import { LINK_ANY } from "./linkContract.js";
import type { FileFilterKind } from "./fileChip.js";
import type { DqDueFilter } from "./dqFleetFilter.js";
import type { DqRosterColumnKey } from "./dqFile.js";

/**
 * The Drivers roster's URL (`/drivers`) for the keys a link sets, read by the roster and by Ask AI's
 * `driver_file_expirations` link (F21 R4b, D-AI6; why: `fuelCostsLinkContract.ts`).
 *
 * ⚠ WHAT A LINK CAN SAY EXACTLY, AND WHAT IT CANNOT (F21 PLAN §5 Q-AI13). The roster's File filter is
 * the driver's WORST chip (`fileChip`: expired, then missing, …, then expiring); the tool's `state` is
 * per ITEM. They agree for `expired` — a driver's chip is expired exactly when any item is — and for
 * nothing else: a driver with one item expiring and one missing is chip "missing", so `file=expiring`
 * would leave out a driver the answer listed. The tool therefore links with filters only for `expired`.
 *
 * `status`: the roster opens on ACTIVE drivers; the tool reads the qualification overview, which holds
 * active and on-leave drivers. `status=any` shows both (and terminated rows, whose files are not read,
 * so none of them is ever `expired`).
 */
export const DRIVERS_QUERY_KEYS = {
  file: "file",
  status: "status",
  search: "q",
  due: "due",
  requirement: "req",
  seat: "seat",
  show: "show",
} as const;

/** `seat=none`: active drivers holding no truck (set by the Operations tab's Seats card). */
export const DRIVERS_SEAT_NONE = "none";
/** `show=archived`: the archived roster, which opens on every status rather than active. */
export const DRIVERS_SHOW_ARCHIVED = "archived";

/**
 * F21 Step 5 added the roster's other URL filters, so `open_view` can write any of them and the roster
 * reads every one through these keys:
 * - `due` is the qualification horizon (`DQ_DUE_FILTERS`: overdue, or overdue-or-due inside 7/14/30 days).
 * - `req` narrows it to ONE requirement (`DQ_ROSTER_COLUMN_KEYS`).
 * - `q` is the roster's search box: name, employee id, phone or Samsara username, as typed.
 */
export interface DriversLinkFilters {
  file?: FileFilterKind;
  /**
   * `null` = every status, written as `any`. ABSENT = the roster's default: active on the live roster,
   * every status on the archived one.
   */
  status?: string | null;
  search?: string;
  due?: DqDueFilter;
  requirement?: DqRosterColumnKey;
  unseated?: boolean;
  archived?: boolean;
}

export function driversToQuery(f: DriversLinkFilters): Record<string, string> {
  const K = DRIVERS_QUERY_KEYS;
  const q: Record<string, string> = {};
  if (f.file) q[K.file] = f.file;
  if (f.status !== undefined) q[K.status] = f.status ?? LINK_ANY;
  if (f.search) q[K.search] = f.search;
  if (f.due) q[K.due] = f.due;
  if (f.requirement) q[K.requirement] = f.requirement;
  if (f.unseated) q[K.seat] = DRIVERS_SEAT_NONE;
  if (f.archived) q[K.show] = DRIVERS_SHOW_ARCHIVED;
  return q;
}
