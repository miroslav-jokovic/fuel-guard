import { Router, type Request } from "express";
import { alertRouteId, alertRoutesSaveSchema, isAlertKey, type AlertKey, type AlertRoutesSave } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { readAlertRoutingView, readMyAlerts, resetAlertRoutes, saveAlertRoutes } from "../alertRoutingSettings.js";

/**
 * `/api/alert-routing` — Settings › Notifications' routing section (HOME-TIME-PLAN HT5, D-HT15).
 *
 * Reached from one screen, so it asks what that screen asks (D-SURF5): `settings: manage`, then the
 * screen `admin.settings.notifications` — the same pair as the page's other save, `PUT
 * /api/org-settings/notifications`. The read is behind them too: it lists every member by name.
 *
 * Each write is audited with the alert and the switches that are ON after it — "who took the fleet
 * manager's email off the overstay alert" is the question a missed alert raises.
 */
export function alertRoutingRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireSection("settings"), requireSurface("admin.settings.notifications"));
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
  /** The alert from the path, checked against the catalogue (`notification_routes.alert` has no CHECK). */
  const alertOf = (req: Request): AlertKey | null => (isAlertKey(req.params.alert) ? req.params.alert : null);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await readAlertRoutingView(adminOf(req), req.auth!.orgId!));
    }),
  );

  router.put(
    "/:alert",
    validateBody(alertRoutesSaveSchema),
    asyncHandler(async (req, res) => {
      const alert = alertOf(req);
      if (!alert) {
        res.status(404).json(apiError("not_found", "No such alert"));
        return;
      }
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const { routes } = res.locals.body as AlertRoutesSave;
      const saved = await saveAlertRoutes(admin, orgId, req.auth!.userId, alert, routes, new Date());
      if (!saved.ok) {
        res.status(422).json(apiError("invalid", saved.problem));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.notification_routes_saved",
        entity: "notification_routes",
        // The carrier, as the other Settings saves do: an audit row's entity id is a uuid, and an alert's
        // key is not one (`writeAudit` would move it to meta and log). The alert is in meta.
        entityId: orgId,
        meta: { alert, on: saved.routes.filter((r) => r.enabled).map(alertRouteId), off: saved.routes.filter((r) => !r.enabled).map(alertRouteId) },
      });
      res.json({ ok: true });
    }),
  );

  router.delete(
    "/:alert",
    asyncHandler(async (req, res) => {
      const alert = alertOf(req);
      if (!alert) {
        res.status(404).json(apiError("not_found", "No such alert"));
        return;
      }
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const removed = await resetAlertRoutes(admin, orgId, alert);
      // Already on the defaults: nothing happened, so nothing is recorded.
      if (removed > 0) {
        await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "settings.notification_routes_reset", entity: "notification_routes", entityId: orgId, meta: { alert, removed } });
      }
      res.json({ ok: true });
    }),
  );

  return router;
}

/**
 * `/api/me/alerts` — what the caller receives (D-HT17's read-only half). Any member: it is their own
 * answer, computed from their own role by the sender's resolver, and it names nobody else.
 */
export function myAlertsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await readMyAlerts(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, req.auth!.userId, req.auth!.role ?? null));
    }),
  );
  return router;
}
