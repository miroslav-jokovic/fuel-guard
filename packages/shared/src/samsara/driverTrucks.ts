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
import { DRIVER_STATUSES_THAT_HOLD_A_TRUCK } from "../constants.js";

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

/** A truck as the assignment pass sees it. */
export interface SeatTruck {
  id: string;
  samsaraVehicleId: string | null;
  assignedDriverId: string | null;
}

/** A driver as the assignment pass sees it — every roster row, with or without a Samsara id. */
export interface SeatDriver {
  id: string;
  samsaraDriverId: string | null;
  status: string | null;
  archived: boolean;
}

export interface SeatPlan {
  /** Trucks whose driver slot changes to this driver. */
  set: Array<{ vehicleId: string; driverId: string }>;
  /** Trucks to empty — each names the driver it expects to find, so a write can repeat it. */
  clear: Array<{ vehicleId: string; driverId: string }>;
  /** Trucks Samsara gave a driver this pass, written or already right (the sync's `assigned`). */
  seated: number;
}

/**
 * What the assignment pass writes to `vehicles.assigned_driver_id`, decided in one place and without a
 * database, so every rule below is a unit test rather than a production surprise.
 *
 * Only a driver who may hold a truck is ranked or kept: `DRIVER_STATUSES_THAT_HOLD_A_TRUCK`, and not
 * archived (0235 takes a row off the roster). On 2026-10-12 a retire dry run would have terminated 13
 * drivers and left Kwanzale Boisseau rankable onto 647 and Tony Lamar named on 594; trucks 563, 578
 * and 809 already named a former driver. So the plan:
 *
 *  1. seats each truck's latest current driver (`parseDriverCurrentTrucks`), among those who may hold one;
 *  2. clears a truck held by somebody who may NOT hold one — whoever wrote it;
 *  3. clears every other truck a placed driver still holds (506/807).
 *
 * A driver who may hold a truck but whom Samsara puts in no truck we carry keeps what they have:
 * "drives something we do not carry" is not "drives nothing". A driver id the roster read did not
 * return is left alone too — unknown is not former.
 */
export function planDriverSeats(
  response: Parameters<typeof parseAssignmentIntervals>[0],
  trucks: SeatTruck[],
  drivers: SeatDriver[],
): SeatPlan {
  const mayHold = (d: SeatDriver) => !d.archived && (DRIVER_STATUSES_THAT_HOLD_A_TRUCK as readonly string[]).includes(d.status ?? "");
  const driverById = new Map(drivers.map((d) => [d.id, d]));
  const bySamsaraTruck = new Map(trucks.filter((t) => t.samsaraVehicleId).map((t) => [t.samsaraVehicleId!, t]));
  const bySamsaraDriver = new Map(drivers.filter((d) => d.samsaraDriverId && mayHold(d)).map((d) => [d.samsaraDriverId!, d.id]));

  const { current, seats } = parseDriverCurrentTrucks(response, {
    isTruck: (id) => bySamsaraTruck.has(id),
    isDriver: (id) => bySamsaraDriver.has(id),
  });

  const holder = new Map(trucks.map((t) => [t.id, t.assignedDriverId]));
  const plan: SeatPlan = { set: [], clear: [], seated: seats.length };
  for (const s of seats) {
    const truck = bySamsaraTruck.get(s.vehicleSamsaraId)!;
    const driverId = bySamsaraDriver.get(s.driverSamsaraId)!;
    if (truck.assignedDriverId === driverId) continue; // already right; a no-op write is still a write
    plan.set.push({ vehicleId: truck.id, driverId });
    holder.set(truck.id, driverId);
  }
  const placed = new Map(current.map((c) => [bySamsaraDriver.get(c.driverSamsaraId)!, bySamsaraTruck.get(c.vehicleSamsaraId)!.id]));
  for (const t of trucks) {
    const driverId = t.assignedDriverId;
    // Only the driver the truck still holds after step 1: a seat just given away needs no clear.
    if (!driverId || holder.get(t.id) !== driverId) continue;
    const d = driverById.get(driverId);
    const former = d !== undefined && !mayHold(d);
    const elsewhere = placed.has(driverId) && placed.get(driverId) !== t.id;
    if (former || elsewhere) plan.clear.push({ vehicleId: t.id, driverId });
  }
  return plan;
}
