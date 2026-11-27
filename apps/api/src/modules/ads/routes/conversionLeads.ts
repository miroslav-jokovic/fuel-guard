import type { Router } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppSection, LeadSources } from "@silvicom/shared";
import { requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { adsConversionLeadsView } from "../report/conversionLeadsView.js";

/**
 * `GET /api/ads/conversion-leads` — how near the carrier is to Meta's qualified-lead goal (ADS-PLATFORM-V2-PLAN V7e).
 * A read of rows we hold, gated as the Overview is (anyone who can VIEW the brief's section). Nothing here turns
 * the goal on: that switch is not built until the sandbox answers Q-AD17. Mounted on `adsRouter` (routes/guard.ts).
 */
export function mountConversionLeadsRoutes(router: Router, deps: { section: AppSection; leadSourcesFor: (admin: SupabaseClient) => LeadSources }): void {
  router.get("/conversion-leads", requireSection(deps.section, "view"), asyncHandler(async (req, res) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    res.json(await adsConversionLeadsView(admin, deps.leadSourcesFor(admin), req.auth!.orgId!, new Date()));
  }));
}
