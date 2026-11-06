import { Router } from "express";
import type { Request, Response } from "express";
import { coverSheetRequestSchema, organizationTimezone, todayInZone, type CoverSheetRequest } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { renderCoverSheets, type CoverSheetDriver } from "../coverSheetPdf.js";

/**
 * `POST /api/compliance/cover-sheets` → a PDF, one scan cover sheet per driver, in the order asked
 * (DRIVER-PAPER-INTAKE-PLAN PI1). Mounted inside the compliance router, which has run `requireAuth`.
 *
 * Gated on `roster: manage`: the sheet exists to file papers into a driver's file, which is that
 * section's write (D-UF5), so it is the same reader the Drivers page's selection bar is shown to.
 * Writes nothing; there is no row to audit. A driver id outside this organization refuses the whole
 * print rather than leaving a gap the person stacking folders would not notice.
 */
export function coverSheetsRouter(): Router {
  const router = Router();
  router.post(
    "/cover-sheets",
    requireOrg,
    requireSection("roster", "manage"),
    validateBody(coverSheetRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { driverIds } = res.locals.body as CoverSheetRequest;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const unique = [...new Set(driverIds)];

      const { data, error } = await admin
        .from("drivers")
        .select("id, full_name, employee_id, hire_date")
        .eq("org_id", orgId)
        .in("id", unique);
      if (error) throw new Error(error.message);
      const byId = new Map(
        ((data ?? []) as Array<{ id: string; full_name: string; employee_id: string | null; hire_date: string | null }>).map((d) => [
          d.id,
          { id: d.id, fullName: d.full_name, employeeId: d.employee_id, hireDate: d.hire_date } satisfies CoverSheetDriver,
        ]),
      );
      if (unique.some((id) => !byId.has(id))) {
        res.status(404).json(apiError("driver_not_found", "One of those drivers is not on this organization's roster."));
        return;
      }

      // The carrier's calendar day for "Printed", as the unit files judge theirs (D-PREC5).
      const { data: org, error: orgError } = await admin.from("organizations").select("operating_hours").eq("id", orgId).maybeSingle();
      if (orgError) throw new Error(orgError.message);
      const printedOn = todayInZone(new Date(), organizationTimezone(org?.operating_hours));

      const pdf = await renderCoverSheets(unique.map((id) => byId.get(id)!), printedOn);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="driver-cover-sheets-${printedOn}.pdf"`);
      res.send(pdf);
    }),
  );
  return router;
}
