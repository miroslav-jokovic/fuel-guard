import { Router } from "express";
import { requireAuth, requireOrg } from "../../../middleware/auth.js";
import { asyncHandler, apiError } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readDashboardSummary } from "../dashboardSummary.js";

/**
 * `GET /api/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD` — the fleet Dashboard in one call
 * (queue item 5 step 3, `docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md` §7.2c).
 *
 * ── WHY IT CARRIES NO SECTION GATE, WHICH IS A DECISION AND NOT AN OMISSION ────────────────────
 * The Dashboard is `gate: ALWAYS` in `surfaceCatalogue.ts` — every role that can sign in lands on
 * it — and the money on it is gated per ELEMENT rather than per section, because neither candidate
 * section expresses the rule (`moneyGate.ts` argues this at length: a dispatcher holds `fuel: view`
 * by design, and `accounting` is right for the dollars and wrong for the page). Refusing this read
 * at a section would be a gate introduced to suit a tile — the ruling `GET /api/fueling/findings/
 * summary` already records in the route ledger for the same page.
 *
 * ⚠ It therefore changes NO boundary: it answers exactly the rows RLS already gives every member of
 * the org through PostgREST today (`ftxn_select`, 0004, is `org_id = auth_org_id()` with no section
 * check). Closing THAT is LM-F2 in `docs/plans/livemap/LIVE-MAP-PLAN.md`, a migration-shaped change
 * with its own owner, and doing it here under cover of a refactor would be a narrowing nobody asked
 * for. The mount's entry in `routeLedger.ts` says the same thing where the fitness function reads it.
 *
 * ── THE WINDOW IS TWO CALENDAR DAYS, AND THE SERVER REFUSES ANYTHING ELSE ──────────────────────
 * `YYYY-MM-DD` in the carrier's own calendar (D-PREC5, queue item 4): the function resolves them
 * against `business_date` and the org's operating zone. An instant would re-introduce exactly the
 * viewer-timezone drift the audit measured, so one is not accepted — a 400 is the honest answer.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function dashboardRouter(): Router {
  const router = Router();
  router.use(requireAuth, requireOrg);

  router.get(
    "/",
    asyncHandler(async (req, res) => {
      const from = String(req.query.from ?? "");
      const to = String(req.query.to ?? "");
      if (!DAY.test(from) || !DAY.test(to)) {
        res.status(400).json(apiError("bad_request", "from and to must be calendar days (YYYY-MM-DD)"));
        return;
      }
      if (from > to) {
        res.status(400).json(apiError("bad_request", "from must not be after to"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const summary = await readDashboardSummary(admin, req.auth!.orgId!, from, to);
      res.json({ ok: true, data: summary });
    }),
  );

  return router;
}
