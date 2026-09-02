import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readIftaPeriod } from "../periodReads.js";

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});

/**
 * The IFTA period read, served by the API instead of a browser RPC (P1.10). The P4.2 decision
 * the original header deferred, now taken: quarterly fuel-tax position is a fuel-section
 * surface, gated on the matrix-derived view set — which now includes the accountant (0266),
 * because IFTA liability is a line in the books. Drivers lose a read they never had a page for.
 */
export function iftaRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    "/period",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?year=YYYY&quarter=1..4."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const rows = await readIftaPeriod(admin, req.auth!.orgId!, parsed.data.year, parsed.data.quarter);
      res.json({ ok: true, ...rows });
    }),
  );
  return router;
}
