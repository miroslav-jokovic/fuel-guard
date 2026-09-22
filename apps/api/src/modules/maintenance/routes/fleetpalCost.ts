import { Router } from "express";
import { coverageIsPrintable } from "@silvicom/shared";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { readCoverage, readUnitCost } from "../../fleetpal/index.js";

/**
 * Per-unit maintenance cost and its coverage bound (FLEETPAL-INTEGRATION-PLAN.md F9b).
 *
 * In `maintenance` because that is the SECTION a shop manager arrives through, reading the
 * collector's exported functions and never a FleetPal payload (D-ARC1) — the same arrangement as
 * `fleetpalUnits.ts` beside it.
 *
 * ── ⚠ THE COST ENDPOINT REFUSES WHEN THE BOUND CANNOT BE COMPUTED (D-FP4) ─────────────────────
 * This is the rule the whole integration is shaped around, and it is enforced here rather than in
 * the page, because a second consumer of the endpoint would otherwise be one `fetch` away from the
 * figure D-FP4 exists to forbid.
 *
 * Summing FleetPal's per-unit totals and putting them in front of somebody who reads them as the
 * whole maintenance bill is the plausible-but-wrong number D-FIN10 refuses. FleetPal knows what the
 * shop spent THROUGH FLEETPAL; the general ledger knows what the company spent through every
 * channel. So every answer carries, for the same months, how much of the ledger's maintenance
 * family FleetPal can be shown to have seen — and when that cannot be computed, there is no answer
 * at all. `409` and not `200 with a null`: a caller that forgets to check a null prints the cost
 * anyway, and a caller that ignores a 409 prints nothing.
 */

/** ⚠ Wall-clock calendar dates in the carrier's own zone, never instants (D-FIN9, D-DATE). */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function window(req: { query: Record<string, unknown> }): { from: string; to: string } | null {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  if (!DATE.test(from) || !DATE.test(to) || from >= to) return null;
  return { from, to };
}

export function fleetpalCostRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * The §2.4 bridge, per month: FleetPal's invoicing, the GL maintenance family, and the portion
   * of the first confirmed in the accounts-payable ledger by an unambiguous invoice-number match.
   *
   * ⚠ `ratioLowerBound` is a LOWER bound and the page must say "at least" beside it (D-FP15). The
   * counts travel with it for the same reason — a bound whose exclusions are invisible is a point
   * estimate wearing a hedge.
   */
  router.get(
    "/fleetpal/coverage",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const w = window(req as never);
      if (!w) {
        res.status(400).json(apiError("bad_request", "from and to must be YYYY-MM-DD with from before to"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const coverage = await readCoverage(admin, req.auth!.orgId!, w.from, w.to);
      res.json({ ok: true, ...coverage, printable: coverageIsPrintable(coverage.months) });
    }),
  );

  /**
   * One unit's maintenance file for the window.
   *
   * The unmatched-unit count rides along on every answer (D-FP14): no surface may print a cost
   * figure without saying how much equipment the reconciliation has not resolved. 48 of 474 on the
   * live account, 2026-09-21.
   */
  router.get(
    "/units/:kind/:id/maintenance",
    requireOrg,
    requireSection("maintenance", "view"),
    asyncHandler(async (req, res) => {
      const kind = String(req.params.kind);
      if (kind !== "tractor" && kind !== "trailer") {
        res.status(400).json(apiError("bad_request", "kind must be tractor or trailer"));
        return;
      }
      const w = window(req as never);
      if (!w) {
        res.status(400).json(apiError("bad_request", "from and to must be YYYY-MM-DD with from before to"));
        return;
      }

      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      // ⚠ The bound is computed BEFORE the cost and gates it. Computing the cost first and then
      // deciding whether to send it would leave the refusal one early `res.json` away from being
      // lost in a later edit; here there is no code path that produces a cost without one.
      const coverage = await readCoverage(admin, orgId, w.from, w.to);
      if (!coverageIsPrintable(coverage.months)) {
        res.status(409).json(
          apiError(
            "coverage_unavailable",
            "Maintenance cost cannot be shown for this window: the general ledger has no swept " +
              "maintenance total for at least one of its months, so there is nothing to measure " +
              "FleetPal's share against.",
          ),
        );
        return;
      }

      const cost = await readUnitCost(admin, orgId, kind, String(req.params.id), w.from, w.to);
      res.json({ ok: true, ...cost, coverage: coverage.months, unmatchedUnits: coverage.unmatchedUnits });
    }),
  );

  return router;
}
