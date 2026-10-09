import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readLiveMapBoardCached } from "../liveMapBoardCache.js";
import { readLoadRoute } from "../liveMapLoadRoute.js";

/**
 * The live map's read surface (LM6).
 *
 * ── GATED `dispatch: view`, AND ENTITLED ON `dispatch` ───────────────────────────────────────────
 * Both layers, the same pair `dispatchRouter` carries. `requireSection("dispatch", "view")` resolves
 * against the caller's ORG OVERRIDES rather than a role list computed at module load, which is the
 * whole point of D-PERM3 — an org that granted its safety manager Dispatch is answered correctly. The
 * `requireModule` layer means a tenant without Dispatch gets one clear 403 naming the module instead
 * of an empty board they cannot explain (D55).
 *
 * ── NO WRITES, SO NO AUDIT ROW ───────────────────────────────────────────────────────────────────
 * `writeAudit` is for state changes. A dispatcher looking at a map is not one, and an audit row per
 * 5-second poll would be 17,000 rows a day per viewer — the same arithmetic that kept LM4's tier out
 * of the jobs ledger.
 */
export function liveMapRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg, requireModule("dispatch"));

  router.get(
    "/positions",
    requireSection("dispatch", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const board = await readLiveMapBoardCached(admin, req.auth!.orgId!);
      res.json({ ok: true, data: board });
    }),
  );

  /**
   * One load's route, split at its truck, with the fuel stops ahead (TRUCK-CARD-ROUTE-PLAN TC3). The
   * same gate as the board (D-TC5): whoever may see the map may draw a route on it. A read, so no audit.
   * A malformed id is a 404 rather than a Postgres cast error surfacing as a 500.
   */
  router.get(
    "/loads/:id/route",
    requireSection("dispatch", "view"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id ?? "");
      if (!UUID.test(id)) {
        res.status(404).json(apiError("not_found", "That load no longer exists"));
        return;
      }
      const env = getAppLocals(req).env;
      const answer = await readLoadRoute(getSupabaseAdmin(env), env, req.auth!.orgId!, id);
      if (!answer.ok) {
        res.status(answer.status).json(apiError(answer.code, answer.message));
        return;
      }
      res.json({ ok: true, data: answer.route });
    }),
  );

  return router;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
