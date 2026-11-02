import { Router, type Request, type Response } from "express";
import { isRecruitingMessageKey, messageWordingSaveSchema, type MessageWordingSave } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { listMessageWording, saveMessageWording } from "../messageWording.js";
import { carrierName } from "../applicationMail.js";

/**
 * Settings → Recruiting's "Messages" (HIRING-WORKFLOW-AUDIT §12 MT2, 0551).
 *
 * The section's own doors, as everything else on that page (§12 D-MT10, `settings.ts`): `recruitment`
 * view reads, `recruitment` manage writes. One PUT per message, the whole wording each time — 0551 keeps
 * every save, so a save IS the full set of four parts, and an absent part is a 400, never "keep".
 *
 * ⚠ The audit row says WHICH message and which parts the carrier wrote, never the words — the same
 * reason `notes.ts` keeps a note's words out of the audit log, which an admin outside hiring can read.
 * The words are in 0551's own history, beside who saved them.
 */
export function recruitmentMessageWordingRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/messages",
    requireOrg,
    requireSection("recruitment", "view"),
    asyncHandler(async (req: Request, res: Response) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      // The carrier's name as the senders read it, so the preview's {carrier} is the applicant's.
      const [messages, carrier] = await Promise.all([listMessageWording(admin, orgId), carrierName(admin, orgId)]);
      res.json({ messages, carrier });
    }),
  );

  router.put(
    "/messages/:key",
    requireOrg,
    requireSection("recruitment"),
    validateBody(messageWordingSaveSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const key = String(req.params.key ?? "");
      if (!isRecruitingMessageKey(key)) {
        res.status(404).json(apiError("not_found", "There is no such message."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const wording = res.locals.body as MessageWordingSave;
      const saved = await saveMessageWording(admin, orgId, {
        userId: req.auth!.userId, role: req.auth!.role ?? null, email: req.auth!.email ?? null,
      }, key, wording);
      if ("status" in saved) {
        res.status(saved.status).json({ error: { ...apiError(saved.code, saved.message).error, issues: saved.issues } });
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruitment.message_wording_saved",
        entity: "recruiting_message_wording",
        entityId: orgId,
        meta: {
          message: key,
          written: (Object.keys(wording) as Array<keyof MessageWordingSave>).filter((p) => wording[p] !== null),
        },
      });
      res.json({ message: saved });
    }),
  );

  return router;
}
