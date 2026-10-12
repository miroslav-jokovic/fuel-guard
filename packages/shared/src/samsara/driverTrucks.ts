/**
 * Each driver's ONE current truck, and each truck's one driver, from Samsara's driver-vehicle
 * assignments.
 *
 * ── WHY "LATEST DRIVER PER TRUCK" IS NOT ENOUGH ON ITS OWN ───────────────────────────────────────
 * `parseCurrentAssignments` answers per TRUCK: who last drove it. A truck a driver LEFT is still
 * answered with that driver for as long as nobody else drives it, and the fetch looks back 30 days.
 * Measured on production 2026-10-12: George Romeo (GROMEO) last drove 506 on 09-18 and has driven 807
 * since; nobody has driven 506 since, so the per-truck answer named him on BOTH, the sync wrote both,
 * and nothing ever cleared 506. 23 drivers were on two trucks that day — each an old 5xx unit the
 * driver had moved off plus the truck they drive now — and the dispatch board and the live map showed
 * the old truck with a driver on it.
 *
 * ── SO EACH DRIVER IS PLACED BY THEIR OWN LATEST START, NOT BY THE TRUCK'S ──────────────────────
 * The first cut of this fix ranked per truck and then kept each driver's newest winning truck. Replayed
 * against production it would have sent Keno Williams back to 586, a truck he left on 09-15: 799 is a
 * TEAM truck, his teammate (Samsara 60886018, not on our roster) started last, so 799 "belonged" to
 * the teammate and Keno's newest remaining win was 586. A team shares a truck; neither of them is
 * anywhere else. So:
 *
 *  1. `current` — per driver, the truck of their latest start. Every driver gets one, teams included.
 *  2. `seats` — per truck, ONE driver for `vehicles.assigned_driver_id`, which holds one: whoever of
 *     the drivers currently in it started last. A teammate who loses the seat is still `current` in
 *     that truck, so a caller can take them off any OTHER truck without putting them in this one.
 *
 * `vehicles.assigned_driver_id` is the domicile default (DRIVER-APP-PLAN D50) — one truck per driver
 * — so this is the shape the column already promises, not a new rule.
 *
 * ── `isTruck` AND `isDriver` ARE REQUIRED, BECAUSE THE FEED CARRIES WHAT WE DO NOT ───────────────
 * `/fleet/driver-vehicle-assignments?filterBy=vehicles` returns trailer pairings beside truck ones.
 * Measured on production 2026-10-12: of 341 Samsara ids assigned in 30 days, 182 are our trucks and
 * 145 our trailers (`trailers.samsara_asset_id`), and a driver's trailer pairing usually starts in
 * the SAME second as their truck's — JBURK on 796 and on trailer R533129, both 10/12 13:11. Ranked
 * together, a driver's "latest truck" is a coin toss between the truck and the trailer behind it. And
 * a driver the caller does not carry cannot be written to a seat, so letting them win one would leave
 * the truck holding whoever it held before — 799's teammate above is exactly that case.
 *
 * Built on `parseAssignmentIntervals` so the two Samsara shapes (flat rows, and a truck with a nested
 * assignments array) are read in one place. An interval with no start time is already dropped there:
 * it cannot be ranked against another, so it cannot be anybody's latest. Ties (two starts in the same
 * millisecond) have no true answer; the lower id wins, so the result never depends on the order
 * Samsara happened to page the rows in.
 */
import { parseAssignmentIntervals, type VehicleDriverLink } from "./entities.js";

export interface DriverTrucks {
  /** One per driver: the truck they are in now. Several drivers may share a truck (a team). */
  current: VehicleDriverLink[];
  /** One per truck: the driver for its single driver slot. */
  seats: VehicleDriverLink[];
}

type Latest = { start: number; id: string };
const newer = (start: number, id: string, prev: Latest | undefined) =>
  !prev || start > prev.start || (start === prev.start && id < prev.id);

export function parseDriverCurrentTrucks(
  response: Parameters<typeof parseAssignmentIntervals>[0],
  carried: { isTruck: (vehicleSamsaraId: string) => boolean; isDriver: (driverSamsaraId: string) => boolean },
): DriverTrucks {
  // 1. Per driver, the truck of their latest start.
  const perDriver = new Map<string, Latest>();
  for (const iv of parseAssignmentIntervals(response)) {
    if (!carried.isTruck(iv.vehicleSamsaraId) || !carried.isDriver(iv.driverSamsaraId)) continue;
    if (newer(iv.startMs, iv.vehicleSamsaraId, perDriver.get(iv.driverSamsaraId))) {
      perDriver.set(iv.driverSamsaraId, { start: iv.startMs, id: iv.vehicleSamsaraId });
    }
  }

  // 2. Per truck, of the drivers in it now, the one who started last.
  const perTruck = new Map<string, Latest>();
  for (const [driverId, { start, id: vehicleId }] of perDriver) {
    if (newer(start, driverId, perTruck.get(vehicleId))) perTruck.set(vehicleId, { start, id: driverId });
  }

  return {
    current: [...perDriver].map(([driverSamsaraId, v]) => ({ vehicleSamsaraId: v.id, driverSamsaraId })),
    seats: [...perTruck].map(([vehicleSamsaraId, d]) => ({ vehicleSamsaraId, driverSamsaraId: d.id })),
  };
}
