import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { resolveIdleCostBasis } from "../idleCostBasis.js";

/**
 * The Idling surface's server-side reads (Q9, `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md`
 * §7.2c step 2).
 *
 * ── ONE ROUTE, ON PURPOSE ──────────────────────────────────────────────────────────────────────
 * Only the cost BASIS moves in this step, not the Idling fold. The basis had to move because
 * `movingSpend = max(0, tractorSpend − idleCostUsd)` makes the Dashboard's fuel figure depend on
 * it, and step 3 cannot assemble that server-side against a basis that only the browser can
 * resolve. The door is opened here rather than inside the Dashboard's own endpoint so that the
 * Idling page and the Dashboard read ONE answer — §7.3's warning is that a half-moved aggregation
 * whose two halves disagree is worse than either end state.
 *
 * ── GATED `safety: view` ───────────────────────────────────────────────────────────────────────
 * `surfaceCatalogue.ts` gates the Idling surface itself on `section("safety")`, so this reads the
 * same matrix the sidebar does rather than a hand-listed role set (D-PERM3): an org that grants its
 * dispatcher Safety is answered correctly with no code change. `view` and not `manage`, because
 * nothing here changes anything — the burn rate and the fallback price are written through the idle
 * settings surface, which carries its own gate.
 *
 * ── NO AUDIT ROW ───────────────────────────────────────────────────────────────────────────────
 * `writeAudit` is for state changes. This is a read of two numbers the page already displays.
 */
export function idleRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);

  router.get(
    "/cost-basis",
    requireSection("safety", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const basis = await resolveIdleCostBasis(admin, req.auth!.orgId!);
      res.json({ ok: true, data: basis });
    }),
  );

  return router;
}
