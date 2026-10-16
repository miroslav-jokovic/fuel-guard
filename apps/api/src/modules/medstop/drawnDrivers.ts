/**
 * Which drivers are drawn for a random test and not yet tested (DISPATCH-BOARD-V2-PLAN §3.5, DBV4) —
 * the dispatch board's read, through this module's index, since only this module reads `medstop_*`.
 *
 * ⚠ A SET OF DRIVER IDS, NOTHING ELSE. The caller decides who may learn that a driver is in it
 * (`randomTestVisible`): no date, no pool, no service and no order leaves here, so no reader can be
 * handed more than "send to collection" by accident.
 *
 * Three org-scoped mirror reads, paged; the verdict is shared's `driversDueForRandomTest`, the Random
 * tab's own list. With Med-Stop not connected every table is empty and so is the set.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { driversDueForRandomTest, type CalendarDay } from "@silvicom/shared";
import { readAll } from "./program.js";

export async function readDriversDueForRandomTest(admin: SupabaseClient, orgId: string, today: CalendarDay): Promise<Set<string>> {
  const employees = await readAll<{ medstop_id: string; driver_id: string | null }>(
    (a, b) => admin.from("medstop_employees").select("medstop_id, driver_id").eq("org_id", orgId).order("medstop_id").range(a, b),
    "medstop_employees",
  );
  const pools = await readAll<{ medstop_id: string; starts_on: string | null; ends_on: string | null; frequency: string | null }>(
    (a, b) => admin.from("medstop_pools").select("medstop_id, starts_on, ends_on, frequency").eq("org_id", orgId).order("medstop_id").range(a, b),
    "medstop_pools",
  );
  const selections = await readAll<{
    medstop_id: string; pool_medstop_id: string | null; employee_medstop_id: string | null; service: string | null;
    selected_on: string | null; request_medstop_id: string | null; test_medstop_id: string | null; status: string | null;
  }>(
    (a, b) => admin.from("medstop_selections")
      .select("medstop_id, pool_medstop_id, employee_medstop_id, service, selected_on, request_medstop_id, test_medstop_id, status")
      .eq("org_id", orgId).order("medstop_id").range(a, b),
    "medstop_selections",
  );

  const driverOf = new Map(employees.map((e) => [e.medstop_id, e.driver_id]));
  return driversDueForRandomTest(
    selections.map((s) => ({
      medstopId: s.medstop_id,
      poolMedstopId: s.pool_medstop_id,
      employeeMedstopId: s.employee_medstop_id,
      service: s.service,
      selectedOn: s.selected_on,
      requestMedstopId: s.request_medstop_id,
      testMedstopId: s.test_medstop_id,
      status: s.status,
    })),
    pools.map((p) => ({ medstopId: p.medstop_id, startsOn: p.starts_on, endsOn: p.ends_on, frequency: p.frequency })),
    (id) => (id ? (driverOf.get(id) ?? null) : null),
    today,
  );
}
