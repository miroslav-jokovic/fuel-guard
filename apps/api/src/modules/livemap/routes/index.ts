import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { requireModule } from "../../../middleware/requireModule.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readLiveMapBoard } from "../liveMapBoard.js";

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
      const board = await readLiveMapBoard(admin, req.auth!.orgId!);
      res.json({ ok: true, data: board });
    }),
  );

  return router;
}
