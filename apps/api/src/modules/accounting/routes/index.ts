import { Router } from "express";
import { z } from "zod";
import { rolesThatCanView } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import {
  searchEntries,
  summarizeByCategory,
  apSpendByAccount,
  getLedgerCoverage,
  computeCpmForWindow,
  getGlMonthlyCosts,
} from "../../financial/index.js";
import { registerCostScheduleRoutes } from "./costSchedules.js";

import { windowSchema, entriesSchema, cpmQuerySchema } from "./schemas.js";

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

  // Cost per mile per truck — the report the whole McLeod pipeline exists to produce. The
  // harness's caveats array is part of the payload ON PURPOSE: a CPM figure whose assumptions
  // are invisible is worse than none, because it gets quoted (cpmHarness.ts's own doctrine).
  // Overhead allocation stays off until finance's §6 Q5 ruling; the report says what it excludes.
  router.get(
    "/cpm",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = cpmQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD with from before to (to is exclusive); optional: deadhead=estimate|exclude, includeOwnerOperators=1."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const f = parsed.data;
      const result = await computeCpmForWindow(admin, req.auth!.orgId!, f.from, f.to, {
        ...(f.deadhead ? { deadhead: f.deadhead } : {}),
        ...(f.includeOwnerOperators !== undefined ? { includeOwnerOperators: f.includeOwnerOperators } : {}),
      });
      res.json({ ok: true, ...result });
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

  // The month's expense accounts from McLeod's own ledger — what the fixed-cost schedule is meant
  // to cover. The schedule page used to assert McLeod "cannot attribute" these costs and show an
  // empty table, which reads as a claim the money is not in McLeod at all; it is (the 2026-08-28
  // reconciliation reproduces the printed income statement to the cent). Only the per-TRUCK split
  // is missing. This endpoint puts the GL lines next to the schedule so the gap is a number.
  router.get(
    "/gl-monthly-costs",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = z.object({ period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?period=YYYY-MM."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const costs = await getGlMonthlyCosts(admin, req.auth!.orgId!, parsed.data.period);
      res.json({ ok: true, ...costs });
    }),
  );

  // Truck fixed-cost schedule CRUD (T1) — its own file; writes audit, reads share the view gate.
  registerCostScheduleRoutes(router);

  return router;
}
