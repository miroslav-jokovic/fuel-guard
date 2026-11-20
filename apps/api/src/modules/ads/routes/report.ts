import type { Request, Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LEAD_COST_RANGE_MAX_DAYS, daysInRange, isCalendarDay, type AppSection, type LeadSources } from "@silvicom/shared";
import { requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { adsLeadCostView } from "../report/leadCostView.js";

/**
 * `/api/ads/report/leads?from=YYYY-MM-DD&to=YYYY-MM-DD` — cost per qualified lead and per hire, by source and by
 * angle (ADS-PLATFORM-V2-PLAN V7d). Read by anyone who can VIEW the brief's section, as the Overview's spend is: it
 * shows what was already spent and moves nothing. Mounted on `adsRouter` (routes/guard.ts), so `requireAuth` +
 * `requireOrg` are in force. Both days are required — a report with no range would be one somebody else picked.
 */
export function mountReportRoutes(router: Router, deps: { section: AppSection; leadSourcesFor: (admin: SupabaseClient) => LeadSources }): void {
  router.get("/report/leads", requireSection(deps.section, "view"), asyncHandler(async (req: Request, res) => {
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    if (!isCalendarDay(from) || !isCalendarDay(to)) {
      res.status(400).json(apiError("bad_request", "Give from and to as days (YYYY-MM-DD)."));
      return;
    }
    if (to < from) {
      res.status(400).json(apiError("bad_request", "The range ends before it starts."));
      return;
    }
    if (daysInRange(from, to) > LEAD_COST_RANGE_MAX_DAYS) {
      res.status(400).json(apiError("bad_request", `Ask for ${LEAD_COST_RANGE_MAX_DAYS} days or fewer at a time.`));
      return;
    }
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    res.json(await adsLeadCostView(admin, deps.leadSourcesFor(admin), req.auth!.orgId!, { from, to }, new Date()));
  }));
}
