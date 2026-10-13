import type { SupabaseClient } from "@supabase/supabase-js";
import type { ShopSummary } from "@silvicom/shared";

/**
 * What FleetPal says is waiting on the shop: open work orders, the oldest one's age, and unresolved
 * defects (FLEET-MANAGER-HOME-PLAN.md step FM3). Whole-org counts over the staging tables F6 and F7
 * fill, read here because this module owns them (D-FP2) and the maintenance router composes them.
 *
 * ── "OPEN" IS THE VENDOR'S `OPEN`, AND NOTHING WIDER ───────────────────────────────────────────
 * `COMPLETED` is finished work not yet settled and `CLOSED` is settled (`FLEETPAL_WORK_ORDER_STATUSES`
 * says why both exist), so neither is waiting on a technician. `PENDING` is in the vendor's vocabulary
 * and held zero rows on 2026-10-13 (24 OPEN, 5,432 CLOSED, 6 CANCELED, 3 COMPLETED); whether a pending
 * order counts as waiting on the shop is a question for the day one exists, not a guess made now.
 *
 * ── NO UNIT JOIN ───────────────────────────────────────────────────────────────────────────────
 * The FleetPal → vehicle mapping is one-to-many (`unitCost.ts`), and an org-level count does not need
 * it: a work order on a unit nobody has matched is still a work order the shop owes. Joining would
 * make the count drop by however many units are unmatched, silently.
 *
 * ── `severity` IS NOT READ ─────────────────────────────────────────────────────────────────────
 * It is null on every staged defect (52 of 52, 2026-10-13), so a "critical defects" figure would be a
 * permanent zero that reads as good news.
 */
export const OPEN_WORK_ORDER_STATUS = "OPEN";

export type ShopBacklog = Pick<ShopSummary, "openWorkOrders" | "oldestOpenWorkOrderAt" | "unresolvedDefects">;

export async function readShopBacklog(admin: SupabaseClient, orgId: string): Promise<ShopBacklog | { error: { message: string } }> {
  // `head: true` asks PostgREST for the count alone, so the figure is the table's and never a page's
  // length — a page stops at 1,000 rows and would be believed.
  const [orders, oldest, defects] = await Promise.all([
    admin
      .from("fleetpal_work_orders")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", OPEN_WORK_ORDER_STATUS),
    admin
      .from("fleetpal_work_orders")
      .select("vendor_created_at")
      .eq("org_id", orgId)
      .eq("status", OPEN_WORK_ORDER_STATUS)
      .not("vendor_created_at", "is", null)
      .order("vendor_created_at", { ascending: true })
      .limit(1),
    admin
      .from("fleetpal_defects")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("is_resolved", false),
  ]);
  const failed = orders.error ?? oldest.error ?? defects.error;
  // The cause goes back whole for the route to log; it names tables, so it never reaches a caller.
  if (failed) return { error: failed };

  const first = (oldest.data ?? [])[0] as { vendor_created_at: string } | undefined;
  return {
    openWorkOrders: orders.count ?? 0,
    oldestOpenWorkOrderAt: first?.vendor_created_at ?? null,
    unresolvedDefects: defects.count ?? 0,
  };
}
