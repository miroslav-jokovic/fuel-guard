import { Router } from "express";
import { z } from "zod";
import { rolesThatCanView } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { searchEntries, moneyByVehicle } from "../../financial/index.js";

const windowSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
});

const invoicesSchema = windowSchema.partial().extend({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * The billing surface (P5.2) — the earnings side, API-only over the financial store. Gated on
 * the matrix-derived view set for `billing` (admin, accountant, auditor); routeGates verifies
 * the gate at runtime.
 *
 * Margin per truck comes free of allocation rules because billing is the one money table that
 * names its tractor — and the unattributed bucket is shown as its OWN row (D-FS5), never
 * spread by a guess. Revenue onto `loads` (FINANCIAL-STORE-PLAN §5.4) is deliberately deferred
 * to the dispatch surface's own step: it changes what a load card means to a dispatcher, which
 * is a product decision, not a billing read.
 */
export function billingRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireRole(...rolesThatCanView("billing"));

  router.get(
    "/invoices",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = invoicesSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid query"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const f = parsed.data;
      const result = await searchEntries(admin, req.auth!.orgId!, {
        q: f.q,
        direction: "earning",
        from: f.from,
        to: f.to,
        limit: f.limit,
        offset: f.offset,
      });
      res.json({ ok: true, ...result });
    }),
  );

  router.get(
    "/margin-by-truck",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = windowSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const trucks = await moneyByVehicle(admin, req.auth!.orgId!, parsed.data.from, parsed.data.to);
      res.json({ ok: true, trucks });
    }),
  );

  return router;
}
