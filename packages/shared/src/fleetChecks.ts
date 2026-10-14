/**
 * The Operations tab's truck questions, each defined ONCE so a card's count and the list it opens
 * cannot disagree (`docs/plans/design-system/FLEET-MANAGER-HOME-PLAN.md` D-FM7).
 *
 * The Seats and Truck paperwork cards count with `matchesVehicleCheck`; the Vehicles page filters with
 * it when a card's door hands it `?check=`. A card that said "11 registrations overdue" over a list
 * showing 9 would be the first bug report the tab got, and the only way to make that impossible is
 * for both to ask the same function.
 *
 * ── "DUE" IS `inspectionExpiry`'s ANSWER, NOT A SECOND ONE ───────────────────────────────────────
 * Both papers are read through `inspectionExpiry` (annualInspectionContract), whose header asks for
 * exactly this: one 30-day mark for equipment, read by "the vehicles page, the trailers page and
 * anything added later", so "expiring" cannot mean two things on two screens. A registration is a
 * different paper with the same question — lapsed, lapsing inside the equipment window, or unknown —
 * so it gets the same answer rather than a parallel constant.
 *
 * `today` is the carrier's calendar day (`todayInZone(…, orgZone)`), because both columns are `date`s
 * (0099) and a viewer in another zone must see the same trucks overdue (D-PREC5).
 *
 * ── NULL IS "NOT ON FILE", NEVER "FINE" ──────────────────────────────────────────────────────────
 * 51 of 244 trucks had no date on 2026-10-12. Counting them as current would make the card read
 * better the less we know, so they get their own check and their own line — `inspectionExpiry`'s
 * `unknown`, which it keeps apart from `expired` for the same reason.
 *
 * ── A TRUCK BEING WOUND DOWN IS NOT A TRUCK WITHOUT A DRIVER ─────────────────────────────────────
 * The Seats card read "159 of 198" on 2026-10-14 when the true answer was 159 of 171: 27 of the 198
 * were trucks McLeod marks `tractor_status = 'I'` — sold and awaiting pickup, or retiring — which stay
 * `active` by design (D-FC0, D-DB11) and which nobody will ever seat. Counted as "no driver", they made
 * the empty-truck line 39 when 12 trucks were actually waiting for a driver. So `isRunningTruck` is the
 * Seats population, `no_driver` asks only of running trucks, and the wound-down trucks get their own
 * check, so they are counted on a line of their own rather than vanishing.
 */
import { INSPECTION_EXPIRY_WARNING_DAYS, inspectionExpiry, type InspectionExpiryState } from "./annualInspectionContract.js";
import type { CalendarDay } from "./calendarDay.js";
import type { Vehicle } from "./fleet.js";

export const VEHICLE_CHECKS = [
  "no_driver",
  "winding_down",
  "inspection_overdue",
  "inspection_due",
  "inspection_missing",
  "registration_overdue",
  "registration_due",
  "registration_missing",
] as const;
export type VehicleCheck = (typeof VEHICLE_CHECKS)[number];

export const VEHICLE_CHECK_LABELS: Record<VehicleCheck, string> = {
  no_driver: "No driver assigned",
  winding_down: "Being wound down (sold or retiring)",
  inspection_overdue: "Annual inspection overdue",
  inspection_due: `Annual inspection due in ${INSPECTION_EXPIRY_WARNING_DAYS} days`,
  inspection_missing: "Annual inspection not on file",
  registration_overdue: "Registration overdue",
  registration_due: `Registration due in ${INSPECTION_EXPIRY_WARNING_DAYS} days`,
  registration_missing: "Registration not on file",
};

type Checked = Pick<Vehicle, "assigned_driver_id" | "dot_annual_inspection_expires_at" | "registration_expires_at" | "winding_down">;

/**
 * A truck the carrier is running: in service, and not one the TMS reports as being wound down. `null`
 * (not reported — every org without McLeod, and any truck before its first sweep) counts as running:
 * the fact is McLeod saying "this one is leaving", and silence is not that.
 */
export function isRunningTruck(v: Pick<Vehicle, "status" | "winding_down">): boolean {
  return v.status === "active" && v.winding_down !== true;
}

/** A check's suffix, in `inspectionExpiry`'s own vocabulary. */
const STATE_OF: Record<string, InspectionExpiryState> = { overdue: "expired", due: "expiring", missing: "unknown" };

/**
 * Does this truck answer yes to `check`? An unknown check is NO filter, not an empty list — it arrives
 * from a query string a person can type into, and a typo must not empty a fleet (the same rule
 * `matchesDqState` keeps).
 */
export function matchesVehicleCheck(v: Checked, check: string, today: CalendarDay): boolean {
  switch (check) {
    case "no_driver":
      return v.assigned_driver_id == null && v.winding_down !== true;
    case "winding_down":
      return v.winding_down === true;
    case "inspection_overdue":
    case "inspection_due":
    case "inspection_missing":
      return inspectionExpiry(v.dot_annual_inspection_expires_at, today).state === STATE_OF[check.slice("inspection_".length)];
    case "registration_overdue":
    case "registration_due":
    case "registration_missing":
      return inspectionExpiry(v.registration_expires_at, today).state === STATE_OF[check.slice("registration_".length)];
    default:
      return true;
  }
}

/**
 * Drivers who hold a truck: everyone named as `assigned_driver_id` on a vehicle that is not retired.
 * A retired truck's last driver does not hold it — that is the case #1471 closed on the board.
 */
export function seatedDriverIds(vehicles: readonly Pick<Vehicle, "assigned_driver_id" | "status">[]): Set<string> {
  const ids = new Set<string>();
  for (const v of vehicles) if (v.assigned_driver_id && v.status !== "retired") ids.add(v.assigned_driver_id);
  return ids;
}

/** The Drivers page's `?seat=` vocabulary. Only `none` narrows; anything else is no filter. */
export const DRIVER_SEAT_FILTERS = ["", "none"] as const;
