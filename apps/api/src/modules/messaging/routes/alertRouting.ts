import { Router, type Request, type Response } from "express";
import {
  alertPhoneConfirmSchema,
  alertPhoneStartSchema,
  alertRouteId,
  alertRoutesSaveSchema,
  alertTextQuietSchema,
  isAlertKey,
  type AlertKey,
  type AlertPhoneConfirm,
  type AlertPhoneStart,
  type AlertRoutesSave,
  type AlertTextQuiet,
  type MyAlertContact,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { readAlertRoutingView, readMyAlerts, resetAlertRoutes, saveAlertRoutes } from "../alertRoutingSettings.js";
import { readAlertTextQuiet, saveAlertTextQuiet } from "../alertTexts.js";
import { confirmAlertPhone, isAlertContactRefusal, readMyAlertContact, startAlertPhone, stopAlertTexts, type AlertContactRefusal } from "../alertContacts.js";

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
      res.json(await readAlertRoutingView(adminOf(req), getAppLocals(req).env, req.auth!.orgId!));
    }),
  );

  // Registered ahead of `/:alert`, so "text-hours" is never read as an alert's key.
  router.put(
    "/text-hours",
    validateBody(alertTextQuietSchema),
    asyncHandler(async (req, res) => {
      const admin = adminOf(req);
      const orgId = req.auth!.orgId!;
      const next = res.locals.body as AlertTextQuiet;
      const before = await readAlertTextQuiet(admin, orgId);
      await saveAlertTextQuiet(admin, orgId, req.auth!.userId, next, new Date());
      await writeAudit(admin, { orgId, actorId: req.auth!.userId, action: "settings.alert_text_hours_saved", entity: "notification_channel_settings", entityId: orgId, meta: { before, after: next } });
      res.json({ ok: true });
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
 * answer, computed by the sender's resolver from the carrier's directory and Permissions page, and it
 * names nobody else.
 */
export function myAlertsRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);
  router.get(
    "/",
    asyncHandler(async (req, res) => {
      res.json(await readMyAlerts(getSupabaseAdmin(getAppLocals(req).env), req.auth!.orgId!, req.auth!.userId));
    }),
  );

  // ── the caller's own mobile number for text alerts (D-HT17, HT6) ─────────────────────────────
  // Their own row and nobody else's: the user id is the token's, never the body's.
  const refuse = (res: Response, r: AlertContactRefusal): void => {
    const status = r.code === "unavailable" ? 503 : r.code === "too_soon" ? 429 : r.code === "db_error" || r.code === "send_failed" ? 502 : 422;
    res.status(status).json(apiError(r.code, r.message));
  };
  const answer = (res: Response, out: MyAlertContact | AlertContactRefusal): void => {
    if (isAlertContactRefusal(out)) refuse(res, out);
    else res.json(out);
  };
  const who = (req: Request) => ({ env: getAppLocals(req).env, admin: getSupabaseAdmin(getAppLocals(req).env), orgId: req.auth!.orgId!, userId: req.auth!.userId });

  router.get(
    "/phone",
    asyncHandler(async (req, res) => {
      const c = who(req);
      res.json(await readMyAlertContact(c.admin, c.env, c.orgId, c.userId));
    }),
  );

  router.post(
    "/phone",
    validateBody(alertPhoneStartSchema),
    asyncHandler(async (req, res) => {
      const c = who(req);
      answer(res, await startAlertPhone(c.admin, c.env, c.orgId, c.userId, (res.locals.body as AlertPhoneStart).phone, new Date()));
    }),
  );

  router.post(
    "/phone/confirm",
    validateBody(alertPhoneConfirmSchema),
    asyncHandler(async (req, res) => {
      const c = who(req);
      const out = await confirmAlertPhone(c.admin, c.env, c.orgId, c.userId, (res.locals.body as AlertPhoneConfirm).code, new Date());
      // The consent is an act worth a row: who agreed to be texted, when, to which words. Never the number.
      if (!isAlertContactRefusal(out)) await writeAudit(c.admin, { orgId: c.orgId, actorId: c.userId, action: "alerts.text_number_confirmed", entity: "notification_contacts", entityId: c.userId, meta: { last4: out.last4 } });
      answer(res, out);
    }),
  );

  router.post(
    "/phone/stop",
    asyncHandler(async (req, res) => {
      const c = who(req);
      const out = await stopAlertTexts(c.admin, c.env, c.orgId, c.userId, new Date());
      await writeAudit(c.admin, { orgId: c.orgId, actorId: c.userId, action: "alerts.text_stopped", entity: "notification_contacts", entityId: c.userId, meta: { by: "page" } });
      res.json(out);
    }),
  );
  return router;
}
