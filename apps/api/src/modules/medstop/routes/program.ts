import { Router } from "express";
import { todayInZone, organizationTimezone } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readDrugAlcoholProgram } from "../program.js";

/**
 * Safety › Drug & Alcohol (MEDSTOP-PLAN.md §6). `safety: view` reads the program — pool pace and the
 * roster reconciliation name no test and no result. The selection lists inside the answer are held
 * to the roles that read testing records (`program.ts`), so the gate here stays the section's.
 */
export function drugAlcoholRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);

  router.get(
    "/program",
    requireSection("safety", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
      const today = todayInZone(new Date(), organizationTimezone(data?.operating_hours));
      res.json({ ok: true, data: await readDrugAlcoholProgram(admin, orgId, req.auth!.role ?? null, today) });
    }),
  );
  return router;
}
