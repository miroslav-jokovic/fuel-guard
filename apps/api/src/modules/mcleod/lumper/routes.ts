import { Router, type Request, type Response } from "express";
import {
  isRecordId,
  lumperCaseCloseSchema,
  lumperFileConfirmSchema,
  lumperFileRemoveSchema,
  type LumperCaseClose,
  type LumperFileConfirm,
  type LumperFileRemove,
} from "@silvicom/shared";
import { requireAuth, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { requireSurface } from "../../../middleware/requireSurface.js";
import {
  closeLumperCase,
  fileRevisedRc,
  isLumperRefusal,
  listLumperCases,
  removeRevisedRc,
  reopenLumperCase,
  revisedRcLink,
  startRevisedRcUpload,
  type LumperRefusal,
} from "./lumperCases.js";

/**
 * `/api/lumper-cases` — the lumper cases page (LUMPER-REVISED-RC-PLAN.md LRC3).
 *
 * ── GATED BY THE SCREEN, NOT A SECTION ──────────────────────────────────────────────────────────
 * Dispatch and billing work the same list, and no section holds both (D-LRC11): the dispatcher has
 * `dispatch` and no money section, the accountant has `billing` and `dispatch: none`. So the gate is
 * the screen entitlement `dispatch.lumper-cases`: on for the roles that manage either section, and an
 * admin turns it on for another role or for one person. Every route here serves that one screen, which
 * is the condition `requireSurface` sets for its use. There is deliberately no narrower "may only
 * look": whoever sees that a revised RC is missing is the person who should be able to file it.
 *
 * Every act is on the Audit page with the order number, never the file's contents.
 */
export function lumperCasesRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("dispatch"), requireSurface("dispatch.lumper-cases"));
  const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);
  const refuse = (res: Response, r: LumperRefusal): void => {
    res.status(r.status).json(apiError(r.code, r.message));
  };
  const idOf = (req: Request, res: Response, what: string): string | null => {
    const id = String(req.params.id ?? "").toLowerCase();
    if (isRecordId(id)) return id;
    res.status(404).json(apiError("not_found", `${what} not found.`));
    return null;
  };
  const audit = (req: Request, action: string, entity: string, entityId: string, meta: Record<string, unknown>) =>
    writeAudit(adminOf(req), { orgId: req.auth!.orgId!, actorId: req.auth!.userId, action, entity, entityId, meta });

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const scope = req.query.scope === "all" ? "all" : "open";
      res.json(await listLumperCases(adminOf(req), req.auth!.orgId!, scope));
    }),
  );

  router.post(
    "/:id/files/upload",
    asyncHandler(async (req, res) => {
      const id = idOf(req, res, "Lumper case");
      if (!id) return;
      const out = await startRevisedRcUpload(adminOf(req), req.auth!.orgId!, id);
      if (isLumperRefusal(out)) return refuse(res, out);
      res.status(201).json(out);
    }),
  );

  router.post(
    "/:id/files",
    validateBody(lumperFileConfirmSchema),
    asyncHandler(async (req, res) => {
      const id = idOf(req, res, "Lumper case");
      if (!id) return;
      const body = res.locals.body as LumperFileConfirm;
      const out = await fileRevisedRc(adminOf(req), req.auth!.orgId!, req.auth!.userId, id, body);
      if (isLumperRefusal(out)) return refuse(res, out);
      await audit(req, "lumper_case.revised_rc_filed", "lumper_cases", id, { orderId: out.orderId, fileId: out.fileId, fileName: body.file_name });
      res.status(201).json({ ok: true, fileId: out.fileId });
    }),
  );

  router.get(
    "/files/:id/link",
    asyncHandler(async (req, res) => {
      const id = idOf(req, res, "File");
      if (!id) return;
      const out = await revisedRcLink(adminOf(req), req.auth!.orgId!, id);
      if (isLumperRefusal(out)) return refuse(res, out);
      res.json(out);
    }),
  );

  router.post(
    "/files/:id/remove",
    validateBody(lumperFileRemoveSchema),
    asyncHandler(async (req, res) => {
      const id = idOf(req, res, "File");
      if (!id) return;
      const body = res.locals.body as LumperFileRemove;
      const out = await removeRevisedRc(adminOf(req), req.auth!.orgId!, req.auth!.userId, id, body.reason, new Date());
      if (isLumperRefusal(out)) return refuse(res, out);
      await audit(req, "lumper_case.revised_rc_removed", "lumper_cases", out.caseId, { fileId: id, fileName: out.fileName, reason: body.reason });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/:id/close",
    validateBody(lumperCaseCloseSchema),
    asyncHandler(async (req, res) => {
      const id = idOf(req, res, "Lumper case");
      if (!id) return;
      const body = res.locals.body as LumperCaseClose;
      const out = await closeLumperCase(adminOf(req), req.auth!.orgId!, req.auth!.userId, id, body, new Date());
      if (isLumperRefusal(out)) return refuse(res, out);
      await audit(req, "lumper_case.closed", "lumper_cases", id, { orderId: out.orderId, reason: body.reason, note: body.note });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/:id/reopen",
    asyncHandler(async (req, res) => {
      const id = idOf(req, res, "Lumper case");
      if (!id) return;
      const out = await reopenLumperCase(adminOf(req), req.auth!.orgId!, id);
      if (isLumperRefusal(out)) return refuse(res, out);
      await audit(req, "lumper_case.reopened", "lumper_cases", id, { orderId: out.orderId, wasReason: out.wasReason });
      res.json({ ok: true });
    }),
  );

  return router;
}
