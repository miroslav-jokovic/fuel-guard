import { Router } from "express";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { parseYmd, windowDays } from "@silvicom/shared";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { resolveIdleCostBasis } from "../idleCostBasis.js";
import { readIdleEquipment } from "../idleEquipment.js";
import { readIdleEngineAvoidable } from "../idleEngineAvoidable.js";
import { readIdleBurnRates } from "../idleBurnRates.js";

/** A year, like the fuel report: each park row is small, but the bound keeps a URL from asking for all time. */
const MAX_AVOIDABLE_DAYS = 366;

/**
 * The Idling surface's server-side reads (Q9, `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md`
 * §7.2c step 2).
 *
 * ── TWO ROUTES, NOT THE FOLD ────────────────────────────────────────────────────────────────────
 * `/equipment` (IE1) is the second: declared equipment beside behaviour, which needs a
 * service-role function. Only the cost BASIS moved in the first step, not the Idling fold. The basis had to move because
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

  // IE1, D-IE7: declared equipment beside long-park behaviour — the same `safety: view` door, for
  // the same reason: it is the Idling surface's own tab, and nothing here writes.
  router.get(
    "/equipment",
    requireSection("safety", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ ok: true, data: await readIdleEquipment(admin, req.auth!.orgId!) });
    }),
  );

  // IE3, D-IE4: the idle engine's avoidable idling over a range of local days — runs IN PARALLEL with
  // today's idle figures until IE5's 14-day gate switches the page over (D-IE9). Same door as above.
  router.get(
    "/engine/avoidable",
    requireSection("safety", "view"),
    asyncHandler(async (req, res) => {
      const from = parseYmd(req.query.from);
      const to = parseYmd(req.query.to);
      if (from == null || to == null || to < from) {
        res.status(400).json(apiError("bad_request", "Expected from and to as YYYY-MM-DD dates, earliest first."));
        return;
      }
      if (windowDays(from, to) > MAX_AVOIDABLE_DAYS) {
        res.status(400).json(apiError("bad_request", `Pick a range of at most ${MAX_AVOIDABLE_DAYS} days.`));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ ok: true, data: await readIdleEngineAvoidable(admin, req.auth!.orgId!, from, to) });
    }),
  );

  // IE4, D-IE5: what an idling engine burns, learned per declared equipment × ambient band over the
  // last 60 days, beside the configured rate every idle dollar still uses. Same door; nothing writes.
  router.get(
    "/engine/burn-rates",
    requireSection("safety", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ ok: true, data: await readIdleBurnRates(admin, req.auth!.orgId!) });
    }),
  );

  return router;
}
