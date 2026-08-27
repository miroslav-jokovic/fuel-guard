import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readIftaPeriod } from "../periodReads.js";

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100),
  quarter: z.coerce.number().int().min(1).max(4),
});

/**
 * The IFTA period read, served by the API instead of a browser RPC (P1.10). Access is
 * deliberately the same audience the invoker RPCs granted — any authenticated org member —
 * so this seam closure changes WHO EXECUTES the query, not who may ask; tightening IFTA to a
 * role set is a phase-P4 access decision, not a carve-out side effect.
 */
export function iftaRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  router.get(
    "/period",
    requireOrg,
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
