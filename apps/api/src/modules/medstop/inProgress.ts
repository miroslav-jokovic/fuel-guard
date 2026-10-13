import type { SupabaseClient } from "@supabase/supabase-js";
import type { InProgressOrder, InProgressTest } from "@silvicom/shared";

/**
 * The In progress tab's rows from the mirror (MEDSTOP-PLAN.md §7A.3, MS-UX1). Narrowed in SQL to what
 * could still be moving — an order Med-Stop is waiting on, a test it has not CLOSED — and the verdict
 * (`inProgressRows` in shared) decides the rest. Both reads are small: on 2026-10-13, one open order
 * and five unfinished tests.
 */
const OPEN_ORDER = ["PROCESSING", "OPEN", "ACTIVE", "PREPARE", "TESTING"];

export async function readInProgress(
  admin: SupabaseClient,
  orgId: string,
): Promise<{ orders: InProgressOrder[]; tests: InProgressTest[] }> {
  const [ordersRes, testsRes] = await Promise.all([
    admin
      .from("medstop_requests")
      .select("medstop_id, employee_medstop_id, service, reason, status, requested_local, test_medstop_id")
      .eq("org_id", orgId)
      .in("status", OPEN_ORDER)
      .is("test_medstop_id", null)
      .limit(1000),
    admin
      .from("medstop_tests")
      .select("medstop_id, employee_medstop_id, service, reason, status, result, collected_local")
      .eq("org_id", orgId)
      .neq("status", "CLOSED")
      .limit(1000),
  ]);
  if (ordersRes.error) throw new Error(`medstop_requests read failed: ${ordersRes.error.message}`);
  if (testsRes.error) throw new Error(`medstop_tests read failed: ${testsRes.error.message}`);
  type O = { medstop_id: string; employee_medstop_id: string | null; service: string | null; reason: string | null; status: string | null; requested_local: string | null; test_medstop_id: string | null };
  type T = { medstop_id: string; employee_medstop_id: string | null; service: string | null; reason: string | null; status: string | null; result: string | null; collected_local: string | null };
  return {
    orders: ((ordersRes.data ?? []) as O[]).map((o) => ({
      medstopId: o.medstop_id, employeeMedstopId: o.employee_medstop_id, service: o.service, reason: o.reason,
      status: o.status, requestedLocal: o.requested_local, testMedstopId: o.test_medstop_id,
    })),
    tests: ((testsRes.data ?? []) as T[]).map((t) => ({
      medstopId: t.medstop_id, employeeMedstopId: t.employee_medstop_id, service: t.service, reason: t.reason,
      status: t.status, result: t.result, collectedLocal: t.collected_local,
    })),
  };
}
