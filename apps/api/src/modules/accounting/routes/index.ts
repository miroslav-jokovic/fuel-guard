import { Router } from "express";
import { z } from "zod";
import { rolesThatCanView } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { searchEntries, summarizeByCategory, apSpendByAccount, getLedgerCoverage } from "../../financial/index.js";

const windowSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}/),
});

const entriesSchema = windowSchema.partial().extend({
  q: z.string().max(80).optional(),
  category: z.string().max(30).optional(),
  direction: z.enum(["earning", "expense"]).optional(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  all: z.coerce.boolean().optional(), // drill-down: include non-canonical + void rows
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * The accounting surface (P5.1) — API-only reads over the financial store (D-SEP7: the finance
 * tables are deny-all; this router IS the read path). Every verb gates on the matrix-derived
 * view set for the `accounting` section — admin, accountant, auditor and nobody else — and the
 * routeGates fitness function verifies the gate exists at runtime.
 *
 * Ledger search serves the owner's stated goal verbatim: payments individually visible,
 * separated, easily searchable. `?all=1` is the drill-down opt-out of the canonical predicate —
 * it exists so an accountant can see the non-canonical twin behind a number, never so a report
 * can sum it.
 */
export function accountingRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const canView = requireRole(...rolesThatCanView("accounting"));

  router.get(
    "/entries",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = entriesSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Invalid query"));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const f = parsed.data;
      const result = await searchEntries(admin, req.auth!.orgId!, {
        q: f.q,
        category: f.category,
        direction: f.direction,
        vehicleId: f.vehicleId,
        driverId: f.driverId,
        from: f.from,
        to: f.to,
        canonicalOnly: !f.all,
        limit: f.limit,
        offset: f.offset,
      });
      res.json({ ok: true, ...result });
    }),
  );

  router.get(
    "/summary",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = windowSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const summary = await summarizeByCategory(admin, req.auth!.orgId!, parsed.data.from, parsed.data.to);
      res.json({ ok: true, summary });
    }),
  );

  // The allocation-rule inventory (FINANCIAL-STORE-PLAN §6): what unattributed cost exists, by
  // GL account. Finance rules on it (§6 Q5); until then overhead stays unallocated and labelled.
  router.get(
    "/spend-by-account",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = windowSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const accounts = await apSpendByAccount(admin, req.auth!.orgId!, parsed.data.from, parsed.data.to);
      res.json({ ok: true, accounts });
    }),
  );

  // The missing-entries instrument (0269): McLeod's own monthly control totals against what our
  // staging holds, module by module. Coverage is a BREADTH signal — modules are lifecycle views
  // of the same dollars (D-MC13) — so the UI must present drift per module, never a summed total.
  router.get(
    "/ledger-coverage",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?period=YYYY-MM."));
        return;
      }
      const [y, m] = parsed.data.period.split("-").map(Number);
      const periodStart = `${parsed.data.period}-01`;
      const next = m === 12 ? `${y! + 1}-01` : `${y}-${String(m! + 1).padStart(2, "0")}`;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const report = await getLedgerCoverage(admin, req.auth!.orgId!, periodStart, `${next}-01`);
      res.json({ ok: true, ...report });
    }),
  );

  return router;
}
