import type { Router } from "express";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readFuelOpportunities } from "../findingsOpportunities.js";
import { readBuyingHabits } from "../buyingHabitsRead.js";
import { idsFrom, ymd } from "./exceptions.js";

/**
 * The open fuel findings, one row per kind, for the Fuel Costs strip (FS-STRIP, Q-FSV15 ruling 1).
 *
 * Gated by the fuel section's view set, like the Fuel Costs page it sits on (`routeGateLedger.test.ts` refuses a
 * route with no gate, and `/findings/summary` is open only because the Dashboard is). Its own
 * file because `routes/exceptions.ts` is at its line budget (`lint:filesize`); it shares that file's query
 * parsers rather than copying them.
 */
export function registerOpportunityRoutes(router: Router): void {
  router.get(
    "/findings/opportunities",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const rows = await readFuelOpportunities(admin, req.auth!.orgId!, {
        from: ymd(req.query.from),
        to: ymd(req.query.to),
        vehicleIds: idsFrom(req.query.vehicles),
      });
      res.json({ ok: true, rows });
    }),
  );

  /**
   * Buying habits, as a monthly table per truck (chunk 9a, Q-F2): the policy premiums nobody can dispute,
   * moved out of the queue into Fuel Costs. Same gate as the strip beside it on that page.
   */
  router.get(
    "/buying-habits",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const table = await readBuyingHabits(admin, req.auth!.orgId!, {
        from: ymd(req.query.from),
        to: ymd(req.query.to),
        vehicleIds: idsFrom(req.query.vehicles),
      });
      res.json({ ok: true, ...table });
    }),
  );
}
