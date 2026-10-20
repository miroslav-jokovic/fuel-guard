/**
 * The Operations tab's truck questions, each defined ONCE so a card's count and the list it opens
 * cannot disagree (`docs/plans/design-system/FLEET-MANAGER-HOME-PLAN.md` D-FM7).
 *
 * The Seats and Truck paperwork cards count with `matchesVehicleCheck`; the Vehicles page filters with
 * it when a card's door hands it `?check=`. A card that said "11 registrations overdue" over a list
 * showing 9 would be the first bug report the tab got, and the only way to make that impossible is
 * for both to ask the same function.
 *
 * ── THE PAPER CHECKS READ THE TRUCK'S FILE, NOT McLEOD'S COLUMN (UNIT-FILES-PLAN D-UF3, UF4) ───
 * Until UF4 these read `registration_expires_at` and `dot_annual_inspection_expires_at` — dates McLeod
 * types, with no paper behind them. Now each asks the truck's file (`buildUnitFile`, served by
 * `/api/compliance/unit-files`): the paper on file and ITS date first, McLeod's date only when no paper
 * is filed — the file's `dateOnly`. Both are judged on equipment's one warning window
 * (`INSPECTION_EXPIRY_WARNING_DAYS`, the mark `inspectionExpiry` reads too) and on the carrier's
 * calendar day, which the API takes from the org zone (D-PREC5). So a fleet with no papers filed counts
 * exactly what it counted before — the card does not jump the day this ships — and a filed paper moves
 * its truck the moment it is filed. Which source answered is a line of its own, `*_date_only`: a date
 * nobody can show the scan for is what an auditor writes up.
 *
 * ── NOTHING IS "NO PAPER, NO DATE", NEVER "FINE" ─────────────────────────────────────────────────
 * 51 of 244 trucks had no date on 2026-10-12. Counting them as current would make the card read
 * better the less we know, so they keep their own check and their own line.
 *
 * ── A TRUCK BEING WOUND DOWN IS NOT A TRUCK WITHOUT A DRIVER ─────────────────────────────────────
 * The Seats card read "159 of 198" on 2026-10-14 when the true answer was 159 of 171: 27 of the 198
 * were trucks McLeod marks `tractor_status = 'I'` — sold and awaiting pickup, or retiring — which stay
 * `active` by design (D-FC0, D-DB11) and which nobody will ever seat. Counted as "no driver", they made
 * the empty-truck line 39 when 12 trucks were actually waiting for a driver. So `isRunningTruck` is the
 * Seats population, `no_driver` asks only of running trucks, and the wound-down trucks get their own
 * check, so they are counted on a line of their own rather than vanishing.
 */
import { INSPECTION_EXPIRY_WARNING_DAYS } from "./annualInspectionContract.js";
import type { FileItemState } from "./fileEngine.js";
import type { Vehicle } from "./fleet.js";
import type { UnitFileCell, UnitFileRow } from "./unitFileContract.js";

export const VEHICLE_CHECKS = [
  "no_driver",
  "winding_down",
  "inspection_overdue",
  "inspection_due",
  "inspection_missing",
  "inspection_date_only",
  "registration_overdue",
  "registration_due",
  "registration_missing",
  "registration_date_only",
] as const;
export type VehicleCheck = (typeof VEHICLE_CHECKS)[number];

export const VEHICLE_CHECK_LABELS: Record<VehicleCheck, string> = {
  no_driver: "No driver assigned",
  winding_down: "Being wound down (sold or retiring)",
  inspection_overdue: "Annual inspection overdue",
  inspection_due: `Annual inspection due in ${INSPECTION_EXPIRY_WARNING_DAYS} days`,
  inspection_missing: "Annual inspection: no paper, no date",
  inspection_date_only: "Annual inspection: date only, no paper",
  registration_overdue: "Registration overdue",
  registration_due: `Registration due in ${INSPECTION_EXPIRY_WARNING_DAYS} days`,
  registration_missing: "Registration: no paper, no date",
  registration_date_only: "Registration: date only, no paper",
};

type Checked = Pick<Vehicle, "assigned_driver_id" | "winding_down">;
/** The truck's file as the checks read it — a row of `/api/compliance/unit-files`. */
type CheckedFile = Pick<UnitFileRow, "items">;

/**
 * A truck the carrier is running: in service, and not one the TMS reports as being wound down. `null`
 * (not reported — every org without McLeod, and any truck before its first sweep) counts as running:
 * the fact is McLeod saying "this one is leaving", and silence is not that.
 */
export function isRunningTruck(v: Pick<Vehicle, "status" | "winding_down">): boolean {
  return v.status === "active" && v.winding_down !== true;
}

/**
 * Where a unit stands on one paper: the filed paper's own date, else McLeod's typed date beside the
 * missing item (D-UF3), else nothing. `source` says which, so a list can print "date only".
 */
export interface PaperStanding {
  goodUntil: string | null;
  state: FileItemState;
  source: "paper" | "date_only" | "none";
}

export function paperStanding(cell: UnitFileCell | undefined): PaperStanding {
  if (cell && cell.state !== "missing") return { goodUntil: cell.goodUntil, state: cell.state, source: "paper" };
  if (cell?.dateOnly) return { goodUntil: cell.dateOnly.goodUntil, state: cell.dateOnly.state, source: "date_only" };
  return { goodUntil: null, state: "missing", source: "none" };
}

/** The catalogue item (`EQUIPMENT_ITEMS`) each paper check asks of. */
export const PAPER_CHECK_ITEMS = { inspection: "annual_inspection", registration: "registration" } as const;
const PAPER_ASKS = ["overdue", "due", "missing", "date_only"] as const;

/**
 * Does this truck answer yes to `check`? An unknown check is NO filter, not an empty list — it arrives
 * from a query string a person can type into, and a typo must not empty a fleet (the same rule
 * `matchesDqState` keeps).
 *
 * A paper check needs the truck's file. Without one (the files have not loaded, or the truck is not in
 * them) it answers no, so a reader that has no file yet must say "loading", never count a zero.
 */
export function matchesVehicleCheck(v: Checked, check: string, file: CheckedFile | undefined): boolean {
  if (check === "no_driver") return v.assigned_driver_id == null && v.winding_down !== true;
  if (check === "winding_down") return v.winding_down === true;
  const cut = check.indexOf("_");
  const item = PAPER_CHECK_ITEMS[check.slice(0, cut) as keyof typeof PAPER_CHECK_ITEMS];
  const ask = check.slice(cut + 1) as (typeof PAPER_ASKS)[number];
  if (cut < 0 || !item || !PAPER_ASKS.includes(ask)) return true;
  if (!file) return false;
  const standing = paperStanding(file.items.find((i) => i.key === item));
  if (ask === "overdue") return standing.state === "expired";
  if (ask === "due") return standing.state === "expiring";
  if (ask === "missing") return standing.source === "none";
  return standing.source === "date_only";
}

/**
 * Drivers who hold a truck: everyone named as `assigned_driver_id` — or as the team's second driver,
 * `co_driver_id` (0475) — on a vehicle that is not retired. A retired truck's last driver does not hold
 * it — that is the case #1471 closed on the board. The second seat counts because the driver is in the
 * truck: on 2026-10-15 three of the eight "drivers without a truck" were the second driver of a team.
 */
export function seatedDriverIds(vehicles: readonly Pick<Vehicle, "assigned_driver_id" | "co_driver_id" | "status">[]): Set<string> {
  const ids = new Set<string>();
  for (const v of vehicles) {
    if (v.status === "retired") continue;
    if (v.assigned_driver_id) ids.add(v.assigned_driver_id);
    if (v.co_driver_id) ids.add(v.co_driver_id);
  }
  return ids;
}

/** The Drivers page's `?seat=` vocabulary. Only `none` narrows; anything else is no filter. */
export const DRIVER_SEAT_FILTERS = ["", "none"] as const;
