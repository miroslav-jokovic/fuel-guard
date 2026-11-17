import type { SupabaseClient } from "@supabase/supabase-js";
import type { TruckPmVerdict } from "@silvicom/shared";

/**
 * The next preventive-maintenance due point on a truck, as the roster's own columns carry it
 * (FLEETPAL-INTEGRATION-PLAN.md F11; D-FP2).
 *
 * `vehicles.next_pm_due_odometer` and `next_pm_due_at` were added in 0099 and had no writer until
 * 2026-10-28: FleetPal's PM schedules are the only source that knows them, and FleetPal's collector
 * may not write `vehicles` (D-FP2) — so it computes the answer (`fleetpal/projectPmDue.ts`) and hands
 * it through this door, the way McLeod's sweep hands the fleet code to `recordVehicleFleetCodes`.
 * Written only on change, as that writer is: a sweep runs hourly, and an unchanged row rewritten
 * every hour is churn no reader can tell from news.
 *
 * Both are NULLABLE and null means "no schedule" — never 0, never today. A truck FleetPal has no
 * schedule for shows nothing, which is F11's done-when.
 *
 * `next_pm_verdict` (0628, Q11) is `pmStatus`'s verdict on the same schedules, so the Vehicles list can
 * say "overdue" or "due soon" without a second rule: the due point alone cannot, because FleetPal's
 * warning window is not on `vehicles`. `unknown` is a schedule that cannot be judged; NULL is still
 * "no schedule".
 */
export interface PmDuePlacement {
  vehicleId: string;
  /** Miles. Null when no mileage interval can be judged. */
  nextPmDueOdometer: number | null;
  /** `YYYY-MM-DD`. Null when no time interval can be judged. */
  nextPmDueAt: string | null;
  /** `truckPmVerdict` over the truck's judged schedules. Null when it has none. */
  nextPmVerdict: TruckPmVerdict | null;
}

const CHUNK = 100;
const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

type Row = { id: string; next_pm_due_odometer: number | string | null; next_pm_due_at: string | null; next_pm_verdict: string | null };
const num = (v: number | string | null): number | null => (v == null ? null : Number(v));

/** Writes the rows whose values differ; returns how many. Vehicles not in `placements` are untouched. */
export async function recordVehiclePmDue(admin: SupabaseClient, orgId: string, placements: PmDuePlacement[]): Promise<number> {
  if (placements.length === 0) return 0;
  const wanted = new Map(placements.map((p) => [p.vehicleId, p]));
  const current = new Map<string, Row>();
  for (const ids of chunks([...wanted.keys()])) {
    const { data, error } = await admin.from("vehicles").select("id, next_pm_due_odometer, next_pm_due_at, next_pm_verdict").eq("org_id", orgId).in("id", ids);
    if (error) throw new Error(`vehicles next_pm_due read failed: ${error.message}`);
    for (const v of (data ?? []) as Row[]) current.set(v.id, v);
  }
  let changed = 0;
  for (const [id, p] of wanted) {
    const c = current.get(id);
    // A row this org does not have is skipped, not invented: the org filter is the only tenant boundary.
    if (!c || (num(c.next_pm_due_odometer) === p.nextPmDueOdometer && c.next_pm_due_at === p.nextPmDueAt && c.next_pm_verdict === p.nextPmVerdict)) continue;
    const { error } = await admin
      .from("vehicles")
      .update({ next_pm_due_odometer: p.nextPmDueOdometer, next_pm_due_at: p.nextPmDueAt, next_pm_verdict: p.nextPmVerdict })
      .eq("org_id", orgId)
      .eq("id", id);
    if (error) throw new Error(`vehicles next_pm_due update failed: ${error.message}`);
    changed += 1;
  }
  return changed;
}
