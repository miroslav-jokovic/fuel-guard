/**
 * F11: the next PM due point on every matched truck, projected onto the roster's own columns
 * (FLEETPAL-INTEGRATION-PLAN.md F11; D-FP2).
 *
 * Runs at the end of every sweep, after the meters and the schedules it reads have landed. For each
 * truck: the soonest `dueOn` across its time intervals and the lowest `dueAtMiles` across its mileage
 * intervals, judged by `pmStatus` like everything else — the same answer the truck's page shows, so
 * a reader of `vehicles.next_pm_due_*` and a reader of the page cannot disagree. The annual is left
 * out: it is our record's (`dot_annual_inspection_expires_at`), and a second column carrying
 * FleetPal's date for it would be the two-sources workaround CLAUDE.md names.
 *
 * Trailers have no such columns (0099 added them to `vehicles` only), so a trailer's PM is read live
 * from the page and projected nowhere. The write goes through roster's `recordVehiclePmDue`, which
 * writes only what changed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readFleetIdentities, recordVehiclePmDue, type PmDuePlacement } from "../roster/index.js";
import { readPmDueFleet } from "./pmDue.js";

export async function projectPmDue(admin: SupabaseClient, orgId: string, now: Date = new Date()): Promise<{ trucks: number; changed: number }> {
  const identities = await readFleetIdentities(admin, orgId);
  const odometers = new Map([...identities.byVehicleId.values()].map((i) => [i.vehicleId, i.odometerMiles]));
  const due = await readPmDueFleet(admin, orgId, odometers, now);

  // One placement per TRUCK, across every FleetPal unit it resolves to (the duplicate-VIN case).
  const byVehicle = new Map<string, PmDuePlacement>();
  for (const u of due) {
    if (!u.unit.vehicle_id) continue;
    const p = byVehicle.get(u.unit.vehicle_id) ?? { vehicleId: u.unit.vehicle_id, nextPmDueOdometer: null, nextPmDueAt: null };
    for (const s of u.schedules) {
      for (const i of s.intervals) {
        if (i.dueOn && (p.nextPmDueAt === null || i.dueOn < p.nextPmDueAt)) p.nextPmDueAt = i.dueOn;
        if (i.dueAtMiles !== null && (p.nextPmDueOdometer === null || i.dueAtMiles < p.nextPmDueOdometer)) p.nextPmDueOdometer = i.dueAtMiles;
      }
    }
    byVehicle.set(u.unit.vehicle_id, p);
  }
  // A truck with a FleetPal unit but no judgeable schedule is written NULL — "no schedule" — rather than
  // left holding a date from a schedule FleetPal has since deleted.
  const changed = await recordVehiclePmDue(admin, orgId, [...byVehicle.values()]);
  return { trucks: byVehicle.size, changed };
}
