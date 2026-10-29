import { EMPLOYED_DRIVER_STATUSES, type DriverStatus } from "./constants.js";

/**
 * The driver statuses that mean a tablet is not coming back by itself (D-DE3, owner 2026-10-27: "flag not
 * returned"). `on_leave` keeps the tablet and is not flagged; `applicant` never held one (0524 gives only to
 * `active` or `on_leave`). The same two `inventory_holder_is_ours` refuses as a destination — said once here
 * for everything above the database, which `assets.ts` filters by and the screens word.
 */
export const DRIVER_LEFT_STATUSES = ["inactive", "terminated"] as const satisfies readonly DriverStatus[];
export function driverHasLeft(status: string | null | undefined): boolean {
  return (DRIVER_LEFT_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * Who a tablet may be GIVEN to (DE2b's driver picker): the employed statuses that have not left — today
 * `active` and `on_leave`, the pair 0524's `inventory_holder_is_ours` admits (`IV012`). Derived from the two
 * lists rather than restated, so the picker cannot offer a driver the database will refuse.
 */
export const DRIVER_STATUSES_THAT_TAKE_A_TABLET = EMPLOYED_DRIVER_STATUSES.filter((s) => !driverHasLeft(s));
