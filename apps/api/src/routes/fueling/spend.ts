import type { Router } from "express";
import { requireRole, requireOrg } from "../../middleware/auth.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { buildFuelSpendRollup } from "../../services/fuelSpendRollup.js";

/**
 * The daily fuel-spend rollup (migration 0244) is READ straight from PostgREST by the web app — the
 * table carries an org-scoped select policy and no client write policy, so a browser can read its own
 * carrier's spend days and cannot assert one. This module exists for the other direction: forcing a
 * REBUILD of a window.
 *
 * The nightly scheduler re-derives a trailing fortnight, which is right for keeping up and useless for
 * two cases this endpoint serves: seeding the history the first time (the fills go back to 2026-02, the
 * scheduler would never reach them), and re-deriving after a fix to the derivation itself.
 */

/** A rebuild reads every fill and engine day in its window, so the window is bounded rather than trusted. */
const MAX_WINDOW_DAYS = 400;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function registerSpendRoutes(router: Router): void {
  router.post(
    "/spend-rollup",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const body = req.body as { from?: unknown; to?: unknown };
      const from = typeof body?.from === "string" ? body.from : "";
      const to = typeof body?.to === "string" ? body.to : "";
      if (!YMD.test(from) || !YMD.test(to)) {
        res.status(400).json(apiError("bad_request", "Expected { from, to } as YYYY-MM-DD dates."));
        return;
      }
      if (to < from) {
        res.status(400).json(apiError("bad_request", "The window ends before it starts."));
        return;
      }
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
      if (days > MAX_WINDOW_DAYS) {
        res.status(400).json(apiError("bad_request", `That window is ${days} days; rebuild at most ${MAX_WINDOW_DAYS} at a time.`));
        return;
      }

      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const result = await buildFuelSpendRollup(admin, orgId, from, to);

      // A rebuild rewrites every derived figure the spend report shows, so it leaves a trace — including
      // the data-quality counts, which are the numbers somebody will want to explain a moved chart with.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "fuel.spend_rollup_rebuilt",
        entity: "fuel_spend_days",
        meta: {
          from,
          to,
          written: result.written,
          deleted: result.deleted,
          rejectedIntervals: result.rejectedIntervals,
          unattributedFills: result.unattributedFills,
          defUnmatched: result.defUnmatched,
        },
      });

      res.json({ ok: true, ...result });
    }),
  );
}
