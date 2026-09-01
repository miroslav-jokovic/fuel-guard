import { Router } from "express";
import { z } from "zod";
import { rolesThatCanView } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { searchEntries } from "../../financial/index.js";
import { inspectionsRouter, inspectionPrintingRouter } from "./inspections.js";
import { inspectorsRouter } from "./inspectors.js";
import { printProfilesRouter } from "./printProfiles.js";

const spendSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * The maintenance surface (P5.3) — a real section with an honest amount of data. It reads
 * `category = 'maintenance'` from the financial store, WHICH IS EMPTY TODAY and says so: the
 * projection assigns that category to nothing yet, because McLeod's repair dollars sit inside
 * AP vouchers under GL accounts finance has not yet ruled on (§6 Q5), with unit numbers in
 * free text ("754 Repair") that D-FS5 forbids guessing at. The response carries that state
 * explicitly so the page can render the truth instead of a mysterious zero.
 *
 * When data DOES arrive it comes from exactly two doors, both dedup-keyed (D-SEP8):
 *  · finance's GLID ruling promotes repair-flavored AP accounts to category='maintenance';
 *  · the FleetPal collector, which MAY NOT land its first row before adopting the same
 *    dedup_key contract — or the fleet is billed twice for the same wrench.
 */
export function maintenanceRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireRole(...rolesThatCanView("maintenance"));

  // The §396.17 annual inspection (ANNUAL-INSPECTION-PLAN.md, step A4) — the module's first owned
  // tables, mounted beside the repair-spend read it was born with. Each sub-router carries its own
  // per-verb gates derived from the same matrix.
  router.use("/inspections", inspectionsRouter());
  router.use("/inspectors", inspectorsRouter());
  // Printing onto the pre-printed pads (D-AVI8): the per-printer offsets, and the sheet they are
  // measured with.
  router.use("/print-profiles", printProfilesRouter());
  router.use("/printing", inspectionPrintingRouter());

  router.get(
    "/spend",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = spendSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const f = parsed.data;
      const result = await searchEntries(admin, req.auth!.orgId!, {
        category: "maintenance",
        from: f.from,
        to: f.to,
        limit: f.limit,
        offset: f.offset,
      });
      res.json({
        ok: true,
        ...result,
        // The page renders this reason verbatim while the store holds nothing — the truth,
        // instead of a mysterious zero.
        pendingSources:
          result.total === 0
            ? "Repair spend is not classified yet: McLeod AP repair dollars await finance's GL-account ruling, and the FleetPal feed awaits its dedup contract."
            : null,
      });
    }),
  );

  return router;
}
