import { Router, type Request, type Response } from "express";
import {
  recordId,
  tollStatementConfirmSchema,
  tollStatementRemoveSchema,
  tollStatementUploadSchema,
  type TollStatementConfirm,
  type TollStatementRemove,
} from "@silvicom/shared";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import {
  isStatementRefusal,
  keepTollStatement,
  listTollStatements,
  removeTollStatement,
  startTollStatementUpload,
  tollStatementLink,
  type StatementRefusal,
} from "../statements.js";

/**
 * `/api/tolls/statements` — the providers' statements, kept as uploaded (TOLLS-PER-TRUCK-PLAN.md TL4a).
 *
 * ── GATED ON ACCOUNTING (D-TL11) ─────────────────────────────────────────────────────────────
 * A statement is a bill: what the fleet paid, per tag, per plaza. It is read and kept by whoever
 * reads the fleet report (`accounting: view` / `manage`), not by whoever keeps the trucks' tags.
 * `check-section-policies` already records `tolls` as spanning both sections.
 *
 * Keeping and removing are audited: who put a statement on file, and who took one off and why, are
 * questions about money the row alone answers only in part.
 */

const idSchema = recordId();
const adminOf = (req: Request) => getSupabaseAdmin(getAppLocals(req).env);

function parseId(req: Request, res: Response): string | null {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    res.status(400).json(apiError("bad_request", "That link does not name a statement."));
    return null;
  }
  return parsed.data;
}

const sendRefusal = (res: Response, r: StatementRefusal) => res.status(r.status).json(apiError(r.code, r.message));

export function tollStatementsRouter(): Router {
  const router = Router();
  router.use(requireOrg);
  const canView = requireSection("accounting", "view");
  const canManage = requireSection("accounting");

  router.get(
    "/",
    canView,
    asyncHandler(async (req, res) => {
      res.json({ ok: true, statements: await listTollStatements(adminOf(req), req.auth!.orgId!) });
    }),
  );

  router.post(
    "/upload",
    canManage,
    validateBody(tollStatementUploadSchema),
    asyncHandler(async (req, res) => {
      res.status(201).json({ ok: true, ...(await startTollStatementUpload(adminOf(req), req.auth!.orgId!)) });
    }),
  );

  router.post(
    "/",
    canManage,
    validateBody(tollStatementConfirmSchema),
    asyncHandler(async (req, res) => {
      const body = res.locals.body as TollStatementConfirm;
      const orgId = req.auth!.orgId!;
      const admin = adminOf(req);
      const out = await keepTollStatement(admin, orgId, req.auth!.userId, body);
      if (isStatementRefusal(out)) return void sendRefusal(res, out);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "tolls.statement_uploaded",
        entity: "toll_statements",
        entityId: out.id,
        meta: { provider: out.provider, fileName: out.fileName, format: out.format, byteSize: out.byteSize, sha256: body.sha256 },
      });
      res.status(201).json({ ok: true, statement: out });
    }),
  );

  router.get(
    "/:id/link",
    canView,
    asyncHandler(async (req, res) => {
      const id = parseId(req, res);
      if (!id) return;
      const out = await tollStatementLink(adminOf(req), req.auth!.orgId!, id);
      if (isStatementRefusal(out)) return void sendRefusal(res, out);
      res.json({ ok: true, ...out });
    }),
  );

  router.post(
    "/:id/remove",
    canManage,
    validateBody(tollStatementRemoveSchema),
    asyncHandler(async (req, res) => {
      const id = parseId(req, res);
      if (!id) return;
      const body = res.locals.body as TollStatementRemove;
      const orgId = req.auth!.orgId!;
      const admin = adminOf(req);
      const out = await removeTollStatement(admin, orgId, req.auth!.userId, id, body.reason, new Date());
      if (isStatementRefusal(out)) return void sendRefusal(res, out);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "tolls.statement_removed",
        entity: "toll_statements",
        entityId: id,
        meta: { provider: out.provider, fileName: out.fileName, reason: body.reason },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}
