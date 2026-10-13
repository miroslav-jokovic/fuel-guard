import { z } from "zod";

/**
 * `GET /api/maintenance/shop-summary` — what is broken or waiting on the shop, as four figures
 * (FLEET-MANAGER-HOME-PLAN.md step FM3, card 5).
 *
 * ── COUNTS, NOT LISTS, AND NO MONEY ─────────────────────────────────────────────────────────────
 * The Operations tab carries no currency figure by construction (D-FM6), so nothing here is a cost:
 * repair spend stays on the shop home, behind its own surface. Each figure is a whole-org count read
 * by the rule that owns it — the work-order status FleetPal sends, the defect's own `is_resolved`,
 * and `isLowStock` through `listLowStock` — never a page of rows added up by the client.
 *
 * `oldestOpenWorkOrderAt` is null exactly when there is no open work order: an age needs a row.
 * It is the INSTANT FleetPal recorded the order (`vendor_created_at`), not a day, because the day it
 * falls on is the carrier's calendar's question and the card already holds the org zone
 * (`todayInZone`); a day cut here would be cut in the server's zone, which is UTC on Railway.
 */
export const shopSummarySchema = z.object({
  openWorkOrders: z.number().int().min(0),
  oldestOpenWorkOrderAt: z.iso.datetime({ offset: true }).nullable(),
  unresolvedDefects: z.number().int().min(0),
  /**
   * Stock LINES at or below their reorder point — a (part, location) pair, so one part short on two
   * shelves is two. That is the row the Parts page's "At reorder point" view lists, and the figure is
   * that list's own total.
   */
  lowStockLines: z.number().int().min(0),
});
export type ShopSummary = z.infer<typeof shopSummarySchema>;
