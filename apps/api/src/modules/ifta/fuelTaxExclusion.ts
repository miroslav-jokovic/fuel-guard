import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Record what the TMS says about one truck's fuel-tax coverage today (IFTA-PRECISION-PLAN IP4, 0433).
 *
 * The roster sweep calls this with the truck's `fuel_tax_excluded` fact on every sweep. Most calls are
 * no-ops — the fact rarely changes, and on 2026-10-05 it was "not excluded" for every tractor McLeod
 * holds — so the function only WRITES on a transition:
 *
 *   excluded, nothing open      → open a period from `day`
 *   not excluded, one open      → close it at `day` (exclusive)
 *   anything else               → nothing
 *
 * `day` is the carrier's calendar day the sweep ran on, passed in rather than read from a clock, so the
 * rule is testable and so one sweep stamps one day on every truck it touches.
 *
 * Only `source = 'mcleod'` periods are opened or closed here. A period the office stated by hand
 * (`'manual'`) is theirs: the sweep neither closes it nor stacks a second one on top of it.
 *
 * Service role: the `.eq("org_id", …)` on every statement is the only tenant boundary.
 */
export type FuelTaxExclusionChange = "opened" | "closed" | null;

export async function recordFuelTaxExclusion(
  admin: SupabaseClient,
  orgId: string,
  vehicleId: string,
  excluded: boolean,
  day: string,
): Promise<FuelTaxExclusionChange> {
  const { data, error } = await admin
    .from("vehicle_fuel_tax_exclusions")
    .select("id, source, excluded_from")
    .eq("org_id", orgId)
    .eq("vehicle_id", vehicleId)
    .is("excluded_to", null)
    .limit(1);
  if (error) throw new Error(`vehicle_fuel_tax_exclusions read failed: ${error.message}`);
  const open = ((data ?? []) as Array<{ id: string; source: string; excluded_from: string }>)[0] ?? null;

  if (excluded && !open) {
    const { error: insErr } = await admin
      .from("vehicle_fuel_tax_exclusions")
      .insert({ org_id: orgId, vehicle_id: vehicleId, excluded_from: day, source: "mcleod" });
    if (insErr) throw new Error(`vehicle_fuel_tax_exclusions insert failed: ${insErr.message}`);
    return "opened";
  }

  // A period opened and closed on the same day would violate `excluded_to > excluded_from`; the switch
  // flipping back within one day leaves the period open until the next day's sweep closes it.
  if (!excluded && open && open.source === "mcleod" && day > open.excluded_from) {
    const { error: updErr } = await admin
      .from("vehicle_fuel_tax_exclusions")
      .update({ excluded_to: day, closed_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("id", open.id);
    if (updErr) throw new Error(`vehicle_fuel_tax_exclusions close failed: ${updErr.message}`);
    return "closed";
  }

  return null;
}
