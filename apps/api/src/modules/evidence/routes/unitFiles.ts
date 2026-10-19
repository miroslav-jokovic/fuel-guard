import { Router } from "express";
import type { Request, Response } from "express";
import { UNIT_SUBJECT_TYPES, type UnitSubjectType } from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getUnitFiles } from "../unitFiles.js";

/**
 * `GET /api/compliance/unit-files?subjectType=tractor|trailer` (UNIT-FILES-PLAN UF2).
 *
 * Gated on `equipment` view, the section a truck's papers belong to (D-UF5) — the same readers the
 * Vehicles and Trailers lists have, so the Files column is never a column some readers of the list
 * are refused. Mounted inside the compliance router, which has already run `requireAuth`.
 */
export function unitFilesRouter(): Router {
  const router = Router();
  router.get(
    "/unit-files",
    requireOrg,
    requireSection("equipment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const subjectType = req.query.subjectType;
      if (typeof subjectType !== "string" || !(UNIT_SUBJECT_TYPES as readonly string[]).includes(subjectType)) {
        res.status(400).json(apiError("bad_query", "subjectType must be tractor or trailer"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const today = new Date().toISOString().slice(0, 10);
      res.json(await getUnitFiles(admin, req.auth!.orgId!, subjectType as UnitSubjectType, today));
    }),
  );
  return router;
}
