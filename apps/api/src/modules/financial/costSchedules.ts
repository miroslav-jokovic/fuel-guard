import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sumFixedCosts,
  type FixedCostSummary,
  type TruckCostScheduleInput,
  type TruckCostScheduleRow,
} from "@silvicom/shared";

/**
 * The truck fixed-cost schedule (T1, TRUCK-COST-ATTRIBUTION-PLAN): CRUD the accounting routes
 * expose to the office, plus the one read the CPM endpoint needs — the window's charge summed
 * per unit. The arithmetic lives in shared (`sumFixedCosts`, contract-tested); this file is I/O
 * and org scoping only, like every service touching the deny-all finance tables (D-SEP7).
 *
 * Amount changes are modelled by CLOSING a row (set effective_to) and adding its successor —
 * the migration header records why — so `updateSchedule` accepts partial fields but the page
 * steers corrections toward close-and-replace for anything that changes history.
 */

const SELECT = "id, unit_number, category, label, monthly_amount, effective_from, effective_to, notes";

type DbRow = Omit<TruckCostScheduleRow, "monthly_amount"> & { monthly_amount: number | string };

const toRow = (r: DbRow): TruckCostScheduleRow => ({ ...r, monthly_amount: Number(r.monthly_amount) });

export async function listSchedules(admin: SupabaseClient, orgId: string): Promise<TruckCostScheduleRow[]> {
  const { data, error } = await admin
    .from("truck_cost_schedules")
    .select(SELECT)
    .eq("org_id", orgId)
    .order("unit_number")
    .order("effective_from");
  if (error) throw new Error(`truck_cost_schedules read failed: ${error.message}`);
  return ((data ?? []) as unknown as DbRow[]).map(toRow);
}

export async function createSchedule(
  admin: SupabaseClient,
  orgId: string,
  input: TruckCostScheduleInput,
): Promise<TruckCostScheduleRow> {
  const { data, error } = await admin
    .from("truck_cost_schedules")
    .insert({ org_id: orgId, ...input })
    .select(SELECT)
    .single();
  if (error) throw new Error(`truck_cost_schedules insert failed: ${error.message}`);
  return toRow(data as unknown as DbRow);
}

export async function updateSchedule(
  admin: SupabaseClient,
  orgId: string,
  id: string,
  patch: Partial<TruckCostScheduleInput>,
): Promise<TruckCostScheduleRow | null> {
  const { data, error } = await admin
    .from("truck_cost_schedules")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .select(SELECT)
    .maybeSingle();
  if (error) throw new Error(`truck_cost_schedules update failed: ${error.message}`);
  return data ? toRow(data as unknown as DbRow) : null;
}

export async function deleteSchedule(admin: SupabaseClient, orgId: string, id: string): Promise<boolean> {
  const { data, error } = await admin
    .from("truck_cost_schedules")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`truck_cost_schedules delete failed: ${error.message}`);
  return data != null;
}

/** The CPM read: the whole-month charge for every unit over the window's months. */
export async function readFixedCostsForMonths(
  admin: SupabaseClient,
  orgId: string,
  months: Array<{ year: number; month: number }>,
): Promise<FixedCostSummary> {
  if (!months.length) return { byUnit: {}, byCategory: {}, total: 0, monthCount: 0 };
  const rows = await listSchedules(admin, orgId);
  return sumFixedCosts(rows, months);
}
