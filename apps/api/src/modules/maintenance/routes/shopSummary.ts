import { Router } from "express";
import type { ShopSummary } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readOpenWorkOrders, readShopBacklog, readUnresolvedDefects } from "../../fleetpal/index.js";
import { listLowStock } from "../inventory/stock.js";
import { isServiceError } from "../inventory/types.js";
import { statusForServiceError } from "../inventory/httpStatus.js";
import { readAnnualDisagreements } from "../inspections/annualDisagreements.js";
import { readAnnualDue } from "../inspections/annualDue.js";

/**
 * `GET /api/maintenance/shop-summary` — the Operations tab's Shop card (FLEET-MANAGER-HOME-PLAN.md
 * FM3): what is broken or waiting on the shop, as counts — and `/work-orders` and `/defects`, the two
 * lists behind them (Q-FM6 (a)). Each count is its list's length (`shopBacklog.ts`).
 *
 * ── TWO OWNERS, ONE ANSWER, NO NEW RULE ────────────────────────────────────────────────────────
 * The work orders and defects are FleetPal's record (D-INV10) and are read by the collector's own
 * `readShopBacklog`; the parts below their reorder point are the shelf's, and are read by
 * `listLowStock` — the reader behind `/inventory/low-stock`, which is the list the card's door opens.
 * Calling it rather than counting `part_stock` here is the point: a second predicate would be a count
 * that agrees with the Parts page until somebody changes one of them (D-FM7).
 *
 * It costs a full read of the stock lines that carry a reorder point to produce one number. That set
 * is bounded by how many lines someone set a reorder point on (`listLowStock` says why), and a cheaper
 * count would have to restate `isLowStock` in SQL, which is the copy D-INV13 refuses.
 *
 * The annual dates to check (DISPATCH-BOARD-V2-PLAN Q-DBV2) are the same shape: the count is the length
 * of `/annual-disagreements`, read by `readAnnualDisagreements` — our record against FleetPal's.
 */
export function shopSummaryRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/shop-summary",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const [backlog, low, annuals] = await Promise.all([readShopBacklog(admin, orgId), listLowStock(admin, orgId), readAnnualDisagreements(admin, orgId)]);
      if ("error" in backlog) {
        dbErrorResponse(res, "maintenance.shop-summary", backlog.error, "Could not load the shop summary");
        return;
      }
      if ("error" in annuals) {
        dbErrorResponse(res, "maintenance.shop-summary", annuals.error, "Could not load the shop summary");
        return;
      }
      if (isServiceError(low)) {
        res.status(statusForServiceError(low.code)).json(apiError(low.code, low.error));
        return;
      }
      const data: ShopSummary = { ...backlog, lowStockLines: low.total, annualDisagreements: annuals.length };
      res.json({ ok: true, data });
    }),
  );

  /** Whole lists, unpaginated: a list of what the shop owes that stopped early would be believed. */
  const list = (path: string, read: typeof readOpenWorkOrders | typeof readUnresolvedDefects | typeof readAnnualDisagreements | typeof readAnnualDue, what: string) =>
    router.get(
      path,
      requireOrg,
      requireSection("maintenance", "view"),
      asyncHandler(async (req, res) => {
        const rows = await read(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!);
        if ("error" in rows) {
          dbErrorResponse(res, `maintenance.${path.slice(1)}`, rows.error, `Could not load the ${what}`);
          return;
        }
        res.json({ ok: true, data: rows });
      }),
    );
  list("/work-orders", readOpenWorkOrders, "open work orders");
  list("/defects", readUnresolvedDefects, "unresolved defects");
  list("/annual-disagreements", readAnnualDisagreements, "annual inspection dates");
  // The worklist's fourth group (D-MX2): due within 30 days or overdue, by our record.
  list("/annual-due", readAnnualDue, "annual inspections due");

  return router;
}
