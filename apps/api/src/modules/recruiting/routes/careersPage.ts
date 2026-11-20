import { Router } from "express";
import { careersPageSaveSchema, type CareersPageSave } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { isCareersPageRefusal, readCareersPage, saveCareersPage } from "../careers/careersPage.js";

/**
 * Settings › Recruiting › Careers page (APPLY-PAGE-PLAN AP1). Two doors, both `recruitment` manage — the section that
 * owns the leads this page brings in, as Tenstreet's card is (`tenstreet.ts`):
 *
 *  · `GET /careers-page` — the card: the handle, on/off, the accommodation contact, the public link, whether the
 *    robot check is set up, and which openings are on the page and why the others are not.
 *  · `PUT /careers-page` — save those. Switching ON asks for a fresh sign-in: from then on the openings are public
 *    and anyone can send this account a lead. Switching off, or saving while off, never asks (Tenstreet's rule:
 *    an off switch that wants a password first is one nobody pulls in a hurry).
 *
 * Audited as `recruitment.careers_page.saved` with what moved.
 */
export function recruitmentCareersPageRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");

  router.get(
    "/careers-page",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      res.json(await readCareersPage(getSupabaseAdmin(env), env, req.auth!.orgId!));
    }),
  );

  router.put(
    "/careers-page",
    requireOrg,
    canManage,
    asyncHandler(async (req, res, next) => {
      const parsed = careersPageSaveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Check the careers page settings."));
        return;
      }
      res.locals.careersPage = parsed.data;
      if (parsed.data.enabled) return requireFreshAuth()(req, res, next);
      next();
    }),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const input = res.locals.careersPage as CareersPageSave;
      const saved = await saveCareersPage(admin, orgId, req.auth!.userId, input, new Date());
      if (isCareersPageRefusal(saved)) {
        res.status(saved.status).json(apiError(saved.code, saved.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruitment.careers_page.saved",
        entity: "recruiting_careers_pages",
        meta: {
          created: saved.before === null,
          handle: { was: saved.before?.handle ?? null, now: input.handle },
          enabled: { was: saved.before?.enabled ?? false, now: input.enabled },
        },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
