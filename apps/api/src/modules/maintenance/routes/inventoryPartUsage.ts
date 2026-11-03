import { Router } from "express";
import { z } from "zod";
import { PART_USAGE_SHOW, PART_USAGE_SORTS } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readPartUsageList } from "../../fleetpal/index.js";

/**
 * `GET /api/maintenance/inventory/part-usage` — Shop parts' list: the catalogue with what the shop
 * went through (SHOP-PARTS-USAGE-PLAN.md SP-U2, D-SPU1). Its own mount rather than a flag on
 * `/inventory/parts`, whose plain catalogue read the pickers and the scanner keep using unchanged;
 * and not `/inventory/parts/usage`, which `/:id` would have to be ordered around.
 *
 * `maintenance: view`, the same gate as the catalogue and a truck's repair record (D-SPU9, Q-SPU1).
 */

const querySchema = z.object({
  search: z.string().max(120).optional(),
  show: z.enum(PART_USAGE_SHOW).default("used"),
  sort: z.enum(PART_USAGE_SORTS).default("used"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function inventoryPartUsageRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const parsed = querySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Check the filter values."));
        return;
      }
      const q = parsed.data;
      const result = await readPartUsageList(
        getSupabaseAdmin(getAppLocals(req).env),
        req.auth!.orgId!,
        { search: q.search, show: q.show, sort: q.sort, descending: q.dir === "desc", limit: q.limit, offset: q.offset },
        new Date(),
      );
      if (!result.ok) {
        dbErrorResponse(res, "maintenance.inventory.part-usage", result.error, "Could not load parts");
        return;
      }
      res.json({ ok: true, ...result.data });
    }),
  );

  return router;
}
