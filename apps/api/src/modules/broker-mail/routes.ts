import { Router, type Request } from "express";
import { z } from "zod";
import {
  BROKER_MAIL_ALL_PERMISSION,
  BROKER_MAIL_TABS,
  brokerMailLeftOutSchema,
  brokerMailSettingsSchema,
  recordId,
  type BrokerMailLeftOut,
  type BrokerMailSettings,
} from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../middleware/auth.js";
import { requireSurface } from "../../middleware/requireSurface.js";
import { requireModule } from "../../middleware/requireModule.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { holdsNamedPermission } from "../org/index.js";
import { readAnswerWithin, readBrokerMailList } from "./brokerMailList.js";
import { readBrokerMailAdmin, saveBrokerMailSettings, setLeftOut } from "./brokerMailAdmin.js";

/**
 * `/api/broker-mail` (BROKER-MAIL-READER-PLAN P2).
 *
 *  · `GET /messages` — the Broker mail page: `dispatch: view` and the `dispatch.broker-mail` screen
 *    (which starts off for every role until the measure week is ruled on). WHOSE rows is asked by name,
 *    `dispatch.broker_mail_all`, and never by `dispatch: manage`, which the dispatcher role holds.
 *  · `GET /admin`, `PUT /settings`, `PUT /mailboxes/:userId/left-out` — Settings › Broker mail, an
 *    ADMIN screen (Q-BM9). Each save is on the Audit page with its old and new value.
 */

const listQuery = z.object({
  tab: z.enum(BROKER_MAIL_TABS).default("waiting"),
  owner: recordId().optional(),
});

export function brokerMailRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("dispatch"));
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
  const settingsGate = [requireSection("settings"), requireSurface("admin.settings.broker-mail")];

  router.get(
    "/messages",
    requireSection("dispatch", "view"),
    requireSurface("dispatch.broker-mail"),
    asyncHandler(async (req, res) => {
      const q = listQuery.safeParse(req.query);
      if (!q.success) {
        res.status(400).json(apiError("bad_request", "Unknown queue or dispatcher."));
        return;
      }
      const seesAll = await holdsNamedPermission(req, BROKER_MAIL_ALL_PERMISSION);
      // Asking for a colleague's rows without the switch is refused, not quietly answered with your own.
      if (q.data.owner && q.data.owner !== req.auth!.userId && !seesAll) {
        res.status(403).json(apiError("forbidden", "You can see only the broker mail in your own Outlook."));
        return;
      }
      res.json(await readBrokerMailList(adminOf(req), {
        orgId: req.auth!.orgId!,
        callerId: req.auth!.userId,
        tab: q.data.tab,
        seesAll,
        ownerId: q.data.owner ?? null,
      }));
    }),
  );

  router.get(
    "/admin",
    ...settingsGate,
    asyncHandler(async (req, res) => {
      res.json(await readBrokerMailAdmin(adminOf(req), getAppLocals(req).env, req.auth!.orgId!));
    }),
  );

  router.put(
    "/settings",
    ...settingsGate,
    validateBody(brokerMailSettingsSchema),
    asyncHandler(async (req, res) => {
      const orgId = req.auth!.orgId!;
      const next = res.locals.body as BrokerMailSettings;
      const admin = adminOf(req);
      const before = await readAnswerWithin(admin, orgId);
      await saveBrokerMailSettings(admin, orgId, req.auth!.userId, next);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.broker_mail_saved",
        entity: "broker_mail_settings",
        entityId: orgId,
        meta: { before: { answerWithinMinutes: before }, after: next },
      });
      res.json(next);
    }),
  );

  router.put(
    "/mailboxes/:userId/left-out",
    ...settingsGate,
    validateBody(brokerMailLeftOutSchema),
    asyncHandler(async (req, res) => {
      const target = recordId().safeParse(req.params.userId);
      if (!target.success) {
        res.status(400).json(apiError("bad_request", "Unknown user."));
        return;
      }
      const orgId = req.auth!.orgId!;
      const { leftOut } = res.locals.body as BrokerMailLeftOut;
      const admin = adminOf(req);
      const r = await setLeftOut(admin, orgId, target.data, leftOut);
      if (!r.ok) {
        res.status(r.code === "not_member" ? 404 : 409).json(apiError(r.code,
          r.code === "not_member" ? "That person is not a member of this company." : "Broker mail reading is not set up for this company yet."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: leftOut ? "settings.broker_mail_left_out" : "settings.broker_mail_taken_back",
        entity: "mail_gateway_config",
        entityId: target.data,
        meta: { userId: target.data, leftOut },
      });
      res.json({ userId: target.data, leftOut });
    }),
  );

  return router;
}
