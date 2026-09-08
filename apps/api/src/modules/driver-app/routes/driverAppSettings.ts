import { Router, type Request, type Response } from "express";
import {
  resolveClosureRequestSchema,
  setDriverAppFeatureRequestSchema,
  setDriverAppOverrideRequestSchema,
  type SetDriverAppFeatureRequest,
  type SetDriverAppOverrideRequest,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { memberLabels, labelOf } from "../../../lib/memberLabels.js";
import {
  ClosureRequestError,
  listClosureRequests,
  resolveClosureRequest,
} from "../accountClosure.js";
import {
  deleteOverride,
  isSettingsError,
  listOrgFeatures,
  listOverrides,
  upsertOrgFeature,
  upsertOverride,
} from "../driverAppSettings.js";

const httpFor = (code: string): number =>
  code === "not_found" ? 404 :
  code === "query_failed" || code === "update_failed" ? 500 :
  400;

/**
 * Driver-app control plane — /api/driver-app/* (hardening plan Phase 5, D-PM6).
 *
 * Two write populations, deliberately different:
 *   * ORG SETTINGS (what every driver sees + behavior config) ride `fleet: manage`
 *     — admin + fleet_manager, the roles that own org-wide operating policy.
 *   * PER-DRIVER OVERRIDES (pilots, exceptions) additionally admit `dispatcher`
 *     (`dispatch: manage`) — day-to-day exception handling is dispatch work.
 * Reads admit the matching view roles so an auditor can inspect without touching.
 *
 * This router is the ONLY door to these tables (0134: RLS on, zero policies) and every write is
 * audited with before-less after-state (the tables are current-value; history lives in audit_log).
 */
export function driverAppSettingsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const settingsView = requireSection("roster", "view");
  const settingsManage = requireSection("roster");
  const overridesView = requireSection("dispatch", "view");
  const overridesManage = requireSection("dispatch");

  const param = (req: Request, name: string): string => {
    const v = req.params[name];
    return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
  };

  // GET /api/driver-app/settings — the org's stored rows (the catalog itself ships in shared).
  router.get(
    "/settings",
    requireOrg,
    settingsView,
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listOrgFeatures(admin, req.auth!.orgId!);
      if (isSettingsError(result)) {
        res.status(httpFor(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ features: result.rows });
    }),
  );

  // PUT /api/driver-app/settings/:featureKey — upsert one feature's enabled + config.
  router.put(
    "/settings/:featureKey",
    requireOrg,
    settingsManage,
    validateBody(setDriverAppFeatureRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as SetDriverAppFeatureRequest;
      const result = await upsertOrgFeature(admin, orgId, req.auth!.userId, param(req, "featureKey"), body);
      if (isSettingsError(result)) {
        res.status(httpFor(result.code)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: result.enabled ? "driver_app.feature_enabled" : "driver_app.feature_disabled",
        entity: "driver_app_features",
        // Step 5.11: no entityId. This row is keyed by (org_id, feature_key) and has no uuid of its
        // own, and `entity_id` is a uuid column — passing the slug lost the ENTIRE audit row on every
        // toggle. The key belongs in meta, where a text value can actually be stored.
        meta: { featureKey: result.featureKey, enabled: result.enabled, config: result.config },
      });
      res.json({ featureKey: result.featureKey, enabled: result.enabled, config: result.config });
    }),
  );

  // GET /api/driver-app/drivers/:driverId/overrides — one driver's exceptions.
  router.get(
    "/drivers/:driverId/overrides",
    requireOrg,
    overridesView,
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const result = await listOverrides(admin, req.auth!.orgId!, param(req, "driverId"));
      if (isSettingsError(result)) {
        res.status(httpFor(result.code)).json(apiError(result.code, result.error));
        return;
      }
      res.json({ overrides: result.rows });
    }),
  );

  // PUT /api/driver-app/drivers/:driverId/overrides/:featureKey — set one exception.
  router.put(
    "/drivers/:driverId/overrides/:featureKey",
    requireOrg,
    overridesManage,
    validateBody(setDriverAppOverrideRequestSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = param(req, "driverId");
      const body = res.locals.body as SetDriverAppOverrideRequest;
      const result = await upsertOverride(admin, orgId, req.auth!.userId, driverId, param(req, "featureKey"), body);
      if (isSettingsError(result)) {
        res.status(httpFor(result.code)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "driver_app.override_set",
        entity: "driver_app_feature_overrides",
        // Step 5.11: the driver, not `${driverId}:${featureKey}`. That composite is not a uuid, so
        // it lost the whole row; the driver id is one, and featureKey is already in meta below.
        entityId: driverId,
        meta: { driverId, featureKey: result.featureKey, enabled: body.enabled, note: body.note ?? null },
      });
      res.json({ featureKey: result.featureKey });
    }),
  );

  // DELETE /api/driver-app/drivers/:driverId/overrides/:featureKey — back to the org setting.
  router.delete(
    "/drivers/:driverId/overrides/:featureKey",
    requireOrg,
    overridesManage,
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const driverId = param(req, "driverId");
      const result = await deleteOverride(admin, orgId, driverId, param(req, "featureKey"));
      if (isSettingsError(result)) {
        res.status(httpFor(result.code)).json(apiError(result.code, result.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "driver_app.override_cleared",
        entity: "driver_app_feature_overrides",
        entityId: driverId, // Step 5.11 — see override_set above.
        meta: { driverId, featureKey: result.featureKey },
      });
      res.json({ featureKey: result.featureKey });
    }),
  );

  /**
   * ── ACCOUNT CLOSURE REQUESTS (P4.2, D-PR8) ─────────────────────────────────────────────────────
   *
   * The fleet's 30-day queue. Gated on `roster: manage` rather than `dispatch`, and the split is the
   * same one this router already draws above: a per-driver feature override is day-to-day exception
   * handling and dispatch owns it, but deciding what happens to a departing driver's personal data
   * is roster work — the same population that issues and revokes their login in the first place.
   *
   * ⚠ `complete` is not a status change, it is an ATTESTATION. A fleet manager pressing it is saying
   * the non-retained data was deleted per the published privacy policy, and 0330 makes that
   * permanent: the row cannot be reopened, so nobody can mark it done for an auditor and quietly
   * move it back. The button's copy in web says exactly that, and it should keep saying it.
   */
  router.get(
    "/closure-requests",
    requireOrg,
    settingsView,
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const rows = await listClosureRequests(admin, orgId);
      // Names are resolved in ONE read for the whole page (0301, S9) rather than one per row.
      const labels = await memberLabels(
        admin,
        orgId,
        rows.map((r) => r.resolved_by).filter((v): v is string => Boolean(v)),
      );
      res.json({
        requests: rows.map(({ resolved_by, ...rest }) => ({
          ...rest,
          resolved_by_name: resolved_by ? labelOf(labels.get(resolved_by)) : null,
        })),
      });
    }),
  );

  for (const [verb, outcome] of [
    ["complete", "completed"],
    ["decline", "declined"],
  ] as const) {
    router.post(
      `/closure-requests/:id/${verb}`,
      requireOrg,
      settingsManage,
      validateBody(resolveClosureRequestSchema),
      asyncHandler(async (req: Request, res: Response) => {
        const admin = getSupabaseAdmin(getAppLocals(req).env);
        const orgId = req.auth!.orgId!;
        const id = param(req, "id");
        const body = res.locals.body as { note?: string };
        try {
          await resolveClosureRequest(admin, orgId, id, outcome, req.auth!.userId, body.note);
        } catch (e) {
          if (e instanceof ClosureRequestError) {
            res.status(e.status).json(apiError(e.code, e.message));
            return;
          }
          throw e;
        }
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: `driver.account_closure_${outcome}`,
          entity: "driver_account_closure_requests",
          entityId: id,
          meta: { outcome, note: body.note ?? null },
        });
        res.json({ ok: true });
      }),
    );
  }

  return router;
}
