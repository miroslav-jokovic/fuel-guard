import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { searchEntries, moneyByVehicle, earningsByDispatcher, dispatcherNamesForEntries } from "../../financial/index.js";

// `to` is exclusive here as everywhere behind the financial store, so `from` must be strictly
// before it; without the refinement an inverted window is a valid request that returns nothing and
// renders as "no data yet" — the same silent shape fixed in the accounting router.
const ORDER_MESSAGE = { message: "`from` must be before `to` (`to` is exclusive)." };
const windowSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  })
  .refine((w) => w.from < w.to, ORDER_MESSAGE);

const invoicesSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional(),
    q: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .refine((w) => !w.from || !w.to || w.from < w.to, ORDER_MESSAGE);

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
  const canView = requireSection("billing", "view");

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
      // Who booked each load (0273). Looked up for THIS page's rows only — the list is 50 of a
      // 90-day window, and reading every bill to label 50 would be a scan per keystroke. The
      // accessorial twin carries the parent bill's id with an ":acc" suffix (the projection's
      // `bill:<id>:acc` dedup key), so both legs of one invoice resolve to the same dispatcher.
      const entries = await dispatcherNamesForEntries(admin, req.auth!.orgId!, result.entries);
      res.json({ ok: true, ...result, entries });
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

  // Earnings per dispatcher (owner request, 2026-08-28). Same GL-booked revenue predicate as every
  // other revenue figure, and the unassigned bucket is its own row — never spread, never dropped.
  router.get(
    "/earnings-by-dispatcher",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = windowSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const dispatchers = await earningsByDispatcher(admin, req.auth!.orgId!, parsed.data.from, parsed.data.to);
      res.json({ ok: true, dispatchers });
    }),
  );

  return router;
}
