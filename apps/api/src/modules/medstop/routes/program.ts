import { Router } from "express";
import { todayInZone, organizationTimezone } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarDay } from "@silvicom/shared";
import { readDrugAlcoholProgram } from "../program.js";
import { registerOrderRoutes, type OrderRouteDeps } from "./order.js";
import { registerCloseRoutes } from "./close.js";
import type { ReleaseOrderedAppointment } from "../closeOrder.js";

/** Today in the org's own zone — a collection day and a selection's age are calendar days there. */
async function orgClock(admin: SupabaseClient, orgId: string): Promise<{ today: CalendarDay; timeZone: string }> {
  const { data } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
  const timeZone = organizationTimezone(data?.operating_hours);
  return { today: todayInZone(new Date(), timeZone), timeZone };
}
const orgToday = async (admin: SupabaseClient, orgId: string): Promise<CalendarDay> => (await orgClock(admin, orgId)).today;

/**
 * Safety › Drug & Alcohol (MEDSTOP-PLAN.md §6). `safety: view` reads the program — pool pace and the
 * roster reconciliation name no test and no result. The selection lists inside the answer are held
 * to the roles that read testing records (`program.ts`), so the gate here stays the section's.
 */
export function drugAlcoholRouter(deps: Pick<OrderRouteDeps, "fillOrderedAppointment"> & { releaseOrderedAppointment: ReleaseOrderedAppointment }): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);

  router.get(
    "/program",
    requireSection("safety", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const today = await orgToday(admin, orgId);
      res.json({ ok: true, data: await readDrugAlcoholProgram(admin, orgId, req.auth!.role ?? null, today) });
    }),
  );
  // UX3: ordering a test — its own role gate, not the section's (`routes/order.ts`).
  registerOrderRoutes(router, { orgClock, fillOrderedAppointment: deps.fillOrderedAppointment });
  // MSO2: closing an open order as a no-show or cancelled — the same role gate (`routes/close.ts`).
  registerCloseRoutes(router, { orgToday, releaseOrderedAppointment: deps.releaseOrderedAppointment });
  return router;
}
