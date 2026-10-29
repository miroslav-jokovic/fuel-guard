import type { DriverStatus } from "./constants.js";

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
