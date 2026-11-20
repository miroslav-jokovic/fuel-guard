import { Router } from "express";
import { tenstreetConnectionSaveSchema, type TenstreetConnectionSave } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { isConnectionRefusal, readTenstreetConnection, rotateTenstreetKey, saveTenstreetConnection } from "../tenstreet/connection.js";

/**
 * Settings › Recruiting › Tenstreet (TENSTREET-INTAKE-PLAN TS4). Three doors, all `recruitment` manage — the section
 * that owns leads, so whoever the org's matrix lets manage recruiting keeps the door the leads come through:
 *
 *  · `GET  /tenstreet/connection` — the card: Company ID, mode, on/off, the masked address, the last seven days.
 *  · `PUT  /tenstreet/connection` — save those three. Switching ON asks for a fresh sign-in, as Med-Stop's sweep and
 *    ordering do (`medstop/routes/integration.ts`): from then on a stranger holding the address can create leads in
 *    this account. Switching off, or saving while off, never asks — an off switch that wants a password first is
 *    one nobody pulls in a hurry.
 *  · `POST /tenstreet/connection/rotate-key` — a new secret, ALWAYS with a fresh sign-in (D-TS7): the answer is the
 *    only time the address leaves the server, and it replaces the old one at once.
 *
 * Every change is audited, never with the key: `recruitment.tenstreet.connection_saved` with what moved, and
 * `recruitment.tenstreet.key_rotated` with the new hint only.
 */
export function recruitmentTenstreetRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canManage = requireSection("recruitment");

  router.get(
    "/tenstreet/connection",
    requireOrg,
    canManage,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      res.json(await readTenstreetConnection(getSupabaseAdmin(env), env, req.auth!.orgId!, new Date()));
    }),
  );

  router.put(
    "/tenstreet/connection",
    requireOrg,
    canManage,
    asyncHandler(async (req, res, next) => {
      const parsed = tenstreetConnectionSaveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Check the Tenstreet settings."));
        return;
      }
      res.locals.tenstreet = parsed.data;
      if (parsed.data.enabled) return requireFreshAuth()(req, res, next);
      next();
    }),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const input = res.locals.tenstreet as TenstreetConnectionSave;
      const saved = await saveTenstreetConnection(admin, orgId, req.auth!.userId, input, new Date());
      if (isConnectionRefusal(saved)) {
        res.status(saved.status).json(apiError(saved.code, saved.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruitment.tenstreet.connection_saved",
        entity: "tenstreet_connections",
        meta: {
          created: saved.before === null,
          companyIdChanged: saved.before !== null && saved.before.company_id !== input.companyId,
          mode: { was: saved.before?.mode ?? null, now: input.mode },
          enabled: { was: saved.before?.enabled ?? false, now: input.enabled },
        },
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/tenstreet/connection/rotate-key",
    requireOrg,
    canManage,
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const rotated = await rotateTenstreetKey(admin, env, orgId, new Date());
      if (isConnectionRefusal(rotated)) {
        res.status(rotated.status).json(apiError(rotated.code, rotated.message));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "recruitment.tenstreet.key_rotated",
        entity: "tenstreet_connections",
        meta: { keyHint: rotated.issued.keyHint, replaced: rotated.replaced }, // never the key
      });
      res.set("Cache-Control", "no-store");
      res.json(rotated.issued);
    }),
  );

  return router;
}
