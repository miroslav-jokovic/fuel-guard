import { Router, type Request } from "express";
import { z } from "zod";
import {
  BROKER_MAIL_ALL_PERMISSION,
  BROKER_MAIL_TABS,
  BROKER_MAIL_WEEK_DAYS,
  isCalendarDay,
  shiftDay,
  todayInZone,
  brokerMailBackupsSchema,
  brokerMailLeftOutSchema,
  brokerMailSettingsSchema,
  recordId,
  type BrokerMailBackups,
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
import { holdsNamedPermission, listOfficeMembers, orgTimezone } from "../org/index.js";
import { readBrokerMailList, readSettingsRow } from "./brokerMailList.js";
import { replaceBackups } from "./brokerMailBackups.js";
import { readBrokerMailAdmin, saveBrokerMailSettings, setLeftOut } from "./brokerMailAdmin.js";
import { readBrokerMailWeek } from "./brokerMailWeek.js";
import { mountDraftRoutes } from "./draftRoutes.js";

/**
 * `/api/broker-mail` (BROKER-MAIL-READER-PLAN P2).
 *
 *  · `GET /messages` — the Broker mail page: `dispatch: view` and the `dispatch.broker-mail` screen
 *    (which starts off for every role until the measure week is ruled on). WHOSE rows is asked by name,
 *    `dispatch.broker_mail_all`, and never by `dispatch: manage`, which the dispatcher role holds.
 *  · `GET /admin`, `PUT /settings`, `PUT /mailboxes/:userId/left-out`, `PUT /mailboxes/:userId/backups` —
 *    Settings › Broker mail, an ADMIN screen (Q-BM9; Q-BM10: only an admin chooses backups). Each save
 *    is on the Audit page with its old and new value.
 *  · `GET /week?from=YYYY-MM-DD` — the measure-only week's report (§8), on the same admin screen: seven
 *    days from `from` in the company's zone; without `from`, the seven days ending today.
 *  · P4 (0656), the email panel: `GET /messages/:id` (the list's rule: own, or all with the switch);
 *    `POST /messages/:id/compose`, `POST /messages/:id/draft` and `POST /messages/:id/close` — the
 *    MAILBOX OWNER's alone, because the draft lands in their Outlook and a close silences their text.
 *    Queueing and closing are audited; a composition is on the cost ledger (0656), never its words.
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

  // P4 (0656): the email panel and the owner's three acts (`draftRoutes.ts`).
  mountDraftRoutes(router);

  router.get(
    "/admin",
    ...settingsGate,
    asyncHandler(async (req, res) => {
      res.json(await readBrokerMailAdmin(adminOf(req), getAppLocals(req).env, req.auth!.orgId!));
    }),
  );

  router.get(
    "/week",
    ...settingsGate,
    asyncHandler(async (req, res) => {
      const orgId = req.auth!.orgId!;
      const raw = typeof req.query.from === "string" ? req.query.from : undefined;
      if (raw !== undefined && !isCalendarDay(raw)) {
        res.status(400).json(apiError("bad_request", "The first day must be a date, YYYY-MM-DD."));
        return;
      }
      const admin = adminOf(req);
      const today = todayInZone(new Date(), await orgTimezone(admin, orgId));
      const from = raw ?? shiftDay(today, -(BROKER_MAIL_WEEK_DAYS - 1));
      if (from > today) {
        res.status(400).json(apiError("bad_request", "The week cannot start in the future."));
        return;
      }
      res.json(await readBrokerMailWeek(admin, orgId, from, shiftDay(from, BROKER_MAIL_WEEK_DAYS - 1)));
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
      const was = await readSettingsRow(admin, orgId);
      const before = { answerWithinMinutes: was.answerWithinMinutes, textsOn: was.textsOnSince !== null, backupAfterMinutes: was.backupAfterMinutes };
      await saveBrokerMailSettings(admin, orgId, req.auth!.userId, next);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.broker_mail_saved",
        entity: "broker_mail_settings",
        entityId: orgId,
        // "When were broker-mail texts switched on, and by whom" is answered here and nowhere else.
        meta: { before, after: next },
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

  router.put(
    "/mailboxes/:userId/backups",
    ...settingsGate,
    validateBody(brokerMailBackupsSchema),
    asyncHandler(async (req, res) => {
      const target = recordId().safeParse(req.params.userId);
      if (!target.success) {
        res.status(400).json(apiError("bad_request", "Unknown user."));
        return;
      }
      const orgId = req.auth!.orgId!;
      const admin = adminOf(req);
      const { backupUserIds } = res.locals.body as BrokerMailBackups;
      const next = [...new Set(backupUserIds)];
      // Every name must be a current office member of THIS company, and nobody is their own backup.
      const members = new Set((await listOfficeMembers(admin, orgId)).map((m) => m.userId));
      if (!members.has(target.data) || next.some((u) => u === target.data || !members.has(u))) {
        res.status(400).json(apiError("bad_request", "A backup must be another current member of this company."));
        return;
      }
      const before = await replaceBackups(admin, orgId, target.data, next, req.auth!.userId);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "settings.broker_mail_backups_saved",
        entity: "broker_mail_backups",
        entityId: target.data,
        meta: { dispatcherUserId: target.data, before, after: next },
      });
      res.json({ userId: target.data, backupUserIds: next });
    }),
  );

  return router;
}
