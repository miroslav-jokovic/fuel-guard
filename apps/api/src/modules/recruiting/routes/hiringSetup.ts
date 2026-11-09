import { Router } from "express";
import { z } from "zod";
import {
  HIRING_PROFILE_V1,
  OPENING_STATUSES,
  hiringProfileSaveSchema,
  openingRecruiterSchema,
  openingSaveSchema,
  type HiringProfileSave,
  type OpeningRecruiterSave,
  type OpeningSave,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { displayNameFor } from "../../../lib/memberLabels.js";
import {
  isSetupError, listHiringProfiles, listOpenings, listRecruiters, saveHiringProfile, saveOpening, setOpeningRecruiter, setOpeningStatus,
} from "../leads/hiringSetup.js";

/**
 * Hiring profiles and openings, office side (ADS-AGENT-BUILD-WORKFLOW.md D1c2; 0553/0554).
 *
 * `recruitment` view reads; `recruitment` manage saves — LEAD-SOURCING-PLAN §4: the profile is "edited by
 * `recruitment: manage`", and an opening is a recruiter's working object. The name on a version is the
 * SESSION's (`displayNameFor`), never the client's. The profile list carries `defaults` (the owner's v1,
 * §3a) so a first save starts from the ruling, not from blanks.
 */
const statusSchema = z.object({ status: z.enum(OPENING_STATUSES) });

export function recruitmentHiringSetupRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");
  const canView = requireSection("recruitment", "view");

  const actorOf = async (req: Parameters<Parameters<typeof asyncHandler>[0]>[0]) => {
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const name = (await displayNameFor(admin, req.auth!.userId, req.auth!.orgId!, req.auth!.role ?? null)) ?? req.auth!.email ?? "An office user";
    return { userId: req.auth!.userId, name: name.trim().slice(0, 200) || "An office user" };
  };

  router.get(
    "/hiring-profiles",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const profiles = await listHiringProfiles(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!);
      res.json({ profiles, defaults: HIRING_PROFILE_V1 });
    }),
  );

  router.post(
    "/hiring-profiles",
    requireOrg,
    canManage,
    validateBody(hiringProfileSaveSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const saved = await saveHiringProfile(admin, orgId, await actorOf(req), res.locals.body as HiringProfileSave);
      if (isSetupError(saved)) {
        res.status(saved.status).json(apiError(saved.code, saved.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.hiring_profile_saved",
        entity: "hiring_profiles", entityId: saved.profile_id, meta: { version: saved.version },
      });
      res.status(saved.version === 1 ? 201 : 200).json(saved);
    }),
  );

  router.get(
    "/openings",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      res.json({ openings: await listOpenings(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!) });
    }),
  );

  router.post(
    "/openings",
    requireOrg,
    canManage,
    validateBody(openingSaveSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const saved = await saveOpening(admin, orgId, await actorOf(req), res.locals.body as OpeningSave);
      if (isSetupError(saved)) {
        res.status(saved.status).json(apiError(saved.code, saved.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.opening_saved",
        entity: "recruiting_openings", entityId: saved.opening_id, meta: { version: saved.version },
      });
      res.status(saved.version === 1 ? 201 : 200).json(saved);
    }),
  );

  router.post(
    "/openings/:openingId/status",
    requireOrg,
    canManage,
    validateBody(statusSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { status } = res.locals.body as z.infer<typeof statusSchema>;
      const result = await setOpeningStatus(admin, orgId, String(req.params.openingId ?? ""), status);
      if (isSetupError(result)) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.opening_status_changed",
        entity: "recruiting_openings", entityId: result.id, meta: { status },
      });
      res.json(result);
    }),
  );

  // LQ2b (Q-AD50 (a)): who may own an opening's leads, and naming them. The list is the access matrix's
  // recruitment managers (`listRecruiters`), so a viewer sees the same names the picker offers a manager.
  router.get(
    "/recruiters",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      res.json({ recruiters: await listRecruiters(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!) });
    }),
  );

  router.post(
    "/openings/:openingId/recruiter",
    requireOrg,
    canManage,
    validateBody(openingRecruiterSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { recruiter_id } = res.locals.body as OpeningRecruiterSave;
      const result = await setOpeningRecruiter(admin, orgId, String(req.params.openingId ?? ""), recruiter_id);
      if (isSetupError(result)) {
        res.status(result.status).json(apiError(result.code, result.message));
        return;
      }
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "recruitment.opening_recruiter_changed",
        entity: "recruiting_openings", entityId: result.id, meta: { recruiter_id },
      });
      res.json(result);
    }),
  );

  return router;
}
