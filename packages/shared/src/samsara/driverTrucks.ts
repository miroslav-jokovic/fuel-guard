/**
 * Each driver's ONE current truck, from Samsara's driver-vehicle assignments.
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
 * So the answer is resolved in both directions: per truck, the latest driver; then per driver, only
 * the truck where that latest start is newest. A driver whose last truck has since been taken by
 * somebody else gets no truck at all, which is what is true.
 *
 * `vehicles.assigned_driver_id` is the domicile default (DRIVER-APP-PLAN D50) — one truck per driver
 * — so this is the shape the column already promises, not a new rule.
 *
 * Built on `parseAssignmentIntervals` so the two Samsara shapes (flat rows, and a truck with a nested
 * assignments array) are read in one place. An interval with no start time is already dropped there:
 * it cannot be ranked against another, so it cannot be anybody's latest.
 */
import { parseAssignmentIntervals, type VehicleDriverLink } from "./entities.js";

export function parseDriverCurrentTrucks(
  response: Parameters<typeof parseAssignmentIntervals>[0],
): VehicleDriverLink[] {
  // Per truck, the assignment with the latest start — `parseCurrentAssignments`'s rule.
  const perTruck = new Map<string, { start: number; driverId: string }>();
  for (const iv of parseAssignmentIntervals(response)) {
    const prev = perTruck.get(iv.vehicleSamsaraId);
    if (!prev || iv.startMs >= prev.start) perTruck.set(iv.vehicleSamsaraId, { start: iv.startMs, driverId: iv.driverSamsaraId });
  }

  // Per driver, the truck they started on most recently. A tie (one driver starting two trucks in
  // the same millisecond) has no true answer; the lower vehicle id wins so the result never depends
  // on the order Samsara happened to page the rows in.
  const perDriver = new Map<string, { start: number; vehicleId: string }>();
  for (const [vehicleId, { start, driverId }] of perTruck) {
    const prev = perDriver.get(driverId);
    if (!prev || start > prev.start || (start === prev.start && vehicleId < prev.vehicleId)) {
      perDriver.set(driverId, { start, vehicleId });
    }
  }

  return [...perDriver.entries()].map(([driverSamsaraId, v]) => ({
    vehicleSamsaraId: v.vehicleId,
    driverSamsaraId,
  }));
}
