import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Questions about `psp_requests` that are not about ORDERING one.
 *
 * ⚠ Its own file rather than a tenth export on `pspOrder.ts`, and for the reason the budget exists
 * to force: that file was at 495 of its 500 lines, so the helper below would have taken it over the
 * wall and the next person to touch PSP ordering would have found no room at all. The seam is real
 * either way — ordering is a lifecycle with a preflight, a billing stance and a vendor call, and
 * this is a read. `psp_requests` belongs to the MODULE (D-SEP1), not to one file in it.
 */

/**
 * Has a PSP record ever been ordered for this driver?
 *
 * ── WHY THIS EXISTS RATHER THAN A `.from("psp_requests")` NEXT DOOR ────────────────────────────
 * `psp_requests` is this module's table (D-SEP1), and `lint:table-access` refuses a raw read of it
 * from anywhere else — which is what it did to B3's hiring checklist, correctly. The checklist needs
 * exactly one bit: whether an order is out, so a PSP step can say *chase this* rather than *do this*
 * (D-HUI4's distinction). Handing that bit over as a question keeps the table's shape here, where
 * the `status` CHECK, the billing stance and the 45-day monitoring flag all live.
 *
 * ⚠ **Deliberately not "is PSP done".** The REPORT is a `qualification_records` row of kind
 * `psp_report`, written both by a settled order here and by `/psp-imports` from a report bought on
 * FMCSA's portal — so completion is the evidence layer's answer, not this module's. A helper that
 * answered the bigger question would put half the checklist's rule in the collector.
 */
export async function hasPspRequest(
  admin: SupabaseClient,
  orgId: string,
  driverId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("psp_requests")
    .select("id")
    .eq("org_id", orgId)
    .eq("driver_id", driverId)
    .limit(1);
  return ((data ?? []) as unknown[]).length > 0;
}

/**
 * The same question for a whole board, in one query (B4).
 *
 * ── WHY A SECOND FUNCTION AND NOT A LOOP OVER THE FIRST ───────────────────────────────────────
 * ⚠ The board folds every applicant on one request, so `hasPspRequest` per row would be one query
 * per applicant for one boolean each. That is the shape `LIVE-MAP-CONCURRENCY-PLAN.md` §7 measured
 * as the thing that refused a whole office, and it took three PRs to undo. The set-based read is
 * the same SQL with `.in()` instead of `.eq()`, so there is no second rule here to get wrong — only
 * a second arity.
 *
 * Returns the ids that HAVE an order, rather than a map to `false`, so a caller cannot accidentally
 * read "absent" as anything but "no order".
 */
export async function driversWithPspRequest(
  admin: SupabaseClient,
  orgId: string,
  driverIds: readonly string[],
): Promise<Set<string>> {
  if (driverIds.length === 0) return new Set();
  const { data } = await admin
    .from("psp_requests")
    .select("driver_id")
    .eq("org_id", orgId)
    .in("driver_id", driverIds);
  return new Set(((data ?? []) as Array<{ driver_id: string }>).map((r) => r.driver_id));
}
