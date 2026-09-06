import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { listPrintProfiles, upsertPrintProfile, type PrintProfileInput } from "../inspections/printProfiles.js";

/**
 * `/api/maintenance/print-profiles` — per-printer registration offsets (D-AVI8).
 *
 * The bounds match 0283's check constraints on purpose. A real misfeed is millimetres; ±72 pt is an
 * inch, already far past anything worth correcting, and the limit turns a typo into a refusal
 * rather than into a page printed off the paper.
 */

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  offsetXPt: z.number().min(-72).max(72),
  offsetYPt: z.number().min(-72).max(72),
  notes: z.string().max(500).nullish(),
});

export function printProfilesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listPrintProfiles(admin, req.auth!.orgId!);
      if ("code" in result) {
        res.status(500).json(apiError(result.code, result.error));
        return;
      }
      res.json({ ok: true, profiles: result });
    }),
  );

  const save = (isUpdate: boolean) =>
    asyncHandler(async (req: Parameters<Parameters<typeof asyncHandler>[0]>[0], res: Parameters<Parameters<typeof asyncHandler>[0]>[1]) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as PrintProfileInput;
      const id = isUpdate ? String(req.params.id ?? "") : undefined;
      const result = await upsertPrintProfile(admin, orgId, req.auth!.userId, body, id);
      if ("code" in result) {
        res.status(result.code === "not_found" ? 404 : 500).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: isUpdate ? "maintenance.print_profile_updated" : "maintenance.print_profile_created",
        entity: "maintenance_print_profiles",
        entityId: result.id,
        meta: { name: body.name, offsetXPt: body.offsetXPt, offsetYPt: body.offsetYPt },
      });
      res.status(isUpdate ? 200 : 201).json({ ok: true, id: result.id });
    });

  const canManage = requireSection("maintenance");
  router.post("/", requireOrg, canManage, validateBody(profileSchema), save(false));
  router.patch("/:id", requireOrg, canManage, validateBody(profileSchema), save(true));

  return router;
}
