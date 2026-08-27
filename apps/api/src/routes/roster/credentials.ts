import { Router, type Response } from "express";
import {
  createDriverLoginSchema,
  resetDriverPasswordSchema,
  type CreateDriverLoginRequest,
  type ResetDriverPasswordRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import {
  DriverCredentialError,
  createDriverLogin,
  disableDriverLogin,
  enableDriverLogin,
  resetDriverPassword,
  revokeDriverLogin,
} from "../../services/driverCredentials.js";

/**
 * Driver app-access lifecycle (DRIVER-CREDENTIALS-PLAN.md DC4) — company-issued logins, managed from
 * the Drivers page. Admin + fleet_manager only (handing out a login is narrower than editing master
 * data, same gate the invite endpoint used). Every action is audited with actor + driver; the
 * generated password appears ONLY in the create/reset response body — never in audit meta or logs.
 */

const CODE_STATUS: Record<DriverCredentialError["code"], number> = {
  not_found: 404,
  already_linked: 409,
  no_login: 409,
  username_taken: 409,
  invalid_username: 422,
  auth_error: 502,
};

function sendCredentialError(res: Response, e: unknown): boolean {
  if (e instanceof DriverCredentialError) {
    res.status(CODE_STATUS[e.code]).json(apiError(e.code, e.message));
    return true;
  }
  return false;
}

export function rosterCredentialsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireRole("admin", "fleet_manager"));

  // Create the login: generates the password, returns it ONCE.
  router.post(
    "/:driverId/credentials",
    validateBody(createDriverLoginSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      try {
        const body = res.locals.body as CreateDriverLoginRequest;
        const issued = await createDriverLogin(admin, orgId, driverId, {
          username: body.username,
          password: body.password,
        });
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "roster.driver_login_created",
          entity: "drivers",
          entityId: driverId,
          meta: { username: issued.username },
        });
        res.json(issued);
      } catch (e) {
        if (!sendCredentialError(res, e)) throw e;
      }
    }),
  );

  // Rotate the password (admin-chosen or generated), returned ONCE.
  router.post(
    "/:driverId/credentials/reset",
    validateBody(resetDriverPasswordSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      try {
        const issued = await resetDriverPassword(admin, orgId, driverId, {
          password: (res.locals.body as ResetDriverPasswordRequest).password,
        });
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "roster.driver_login_reset",
          entity: "drivers",
          entityId: driverId,
          meta: { username: issued.username },
        });
        res.json(issued);
      } catch (e) {
        if (!sendCredentialError(res, e)) throw e;
      }
    }),
  );

  // Temporary hold / lift — ban-based, cuts refresh immediately, revokes push tokens.
  for (const [action, run, audit] of [
    ["disable", disableDriverLogin, "roster.driver_login_disabled"],
    ["enable", enableDriverLogin, "roster.driver_login_enabled"],
  ] as const) {
    router.post(
      `/:driverId/credentials/${action}`,
      asyncHandler(async (req, res) => {
        const env = getAppLocals(req).env;
        const admin = getSupabaseAdmin(env);
        const orgId = req.auth!.orgId!;
        const driverId = String(req.params.driverId ?? "");
        try {
          await run(admin, orgId, driverId);
          await writeAudit(admin, {
            orgId,
            actorId: req.auth!.userId,
            action: audit,
            entity: "drivers",
            entityId: driverId,
          });
          res.json({ ok: true });
        } catch (e) {
          if (!sendCredentialError(res, e)) throw e;
        }
      }),
    );
  }

  // Permanent removal: auth user deleted, roster row unlinked (username kept for a re-issue).
  router.delete(
    "/:driverId/credentials",
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const driverId = String(req.params.driverId ?? "");
      try {
        await revokeDriverLogin(admin, orgId, driverId);
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "roster.driver_login_revoked",
          entity: "drivers",
          entityId: driverId,
        });
        res.json({ ok: true });
      } catch (e) {
        if (!sendCredentialError(res, e)) throw e;
      }
    }),
  );

  return router;
}
