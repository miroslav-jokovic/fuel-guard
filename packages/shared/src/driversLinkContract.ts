import { LINK_ANY } from "./linkContract.js";
import type { FileFilterKind } from "./fileChip.js";

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
export const DRIVERS_QUERY_KEYS = { file: "file", status: "status" } as const;

export interface DriversLinkFilters {
  file: FileFilterKind;
  /** `null` = every status, written as `any` (the roster's default is active). */
  status: string | null;
}

export function driversToQuery(f: DriversLinkFilters): Record<string, string> {
  return { [DRIVERS_QUERY_KEYS.file]: f.file, [DRIVERS_QUERY_KEYS.status]: f.status ?? LINK_ANY };
}
