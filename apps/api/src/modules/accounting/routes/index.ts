import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import {
  searchEntries,
  summarizeByCategory,
  apSpendByAccount,
  getLedgerCoverage,
  getMonthCloses,
  getIncomeStatement,
  getMileageCoverage,
  getFleetReport,
  getFleetTrend,
  getBillingActivity,
} from "../../financial/index.js";

import { windowSchema, entriesSchema, trendSchema, activityQuerySchema } from "./schemas.js";

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
  const canView = requireSection("accounting", "view");

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

  // `GET /cpm` went at G7b with the per-truck harness behind it. Its two surviving readers — the
  // truck rows and the contractor rows — are fields on `/fleet-report` now, so every tab of the
  // page reads one call, which is what §2.5 asked for. Nothing else consumed the route.

  // The missing-entries instrument (0269): McLeod's own monthly control totals against what our
  // staging holds, module by module. Coverage is a BREADTH signal — modules are lifecycle views
  // of the same dollars (D-MC13) — so the UI must present drift per module, never a summed total.
  // The monthly close (D-FIN14): every (company, month) the sweeps have landed, with the buckets,
  // the residuals and the verdict — hardened only when every tie-out reads 0.00. The Books check
  // page (F15) renders it; the finance pages print a month's status from it.
  router.get(
    "/month-closes",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const closes = await getMonthCloses(admin, req.auth!.orgId!);
      res.json({ ok: true, closes });
    }),
  );

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

  /**
   * The income statement (G3) — the ledger in the shape the owner's own printed P&L takes.
   *
   * Windowed like every other finance read, then widened to the calendar months it touches,
   * because GL totals are month-grained: a request for 14 July to 3 August is answered with July
   * and August whole, and the response says which months it covered. Prorating a month's journal
   * entries across days would be an allocation, and this section does not allocate (D-FLEET8).
   */
  router.get(
    "/income-statement",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = windowSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const statement = await getIncomeStatement(admin, req.auth!.orgId!, parsed.data.from, parsed.data.to);
      res.json({ ok: true, ...statement });
    }),
  );

  /**
   * The fleet report (G1) — one call serving every tab: the ledger's totals, the company and
   * contractor columns, the per-mile figures or the reason there are none, the income statement,
   * and the two denominators.
   *
   * It subsumes `/income-statement` and `/mileage-coverage`, which stay because they are cheaper
   * when a page needs only one of them; nothing about the figures differs, because all three call
   * the same pure builders over the same reads.
   */
  router.get(
    "/fleet-report",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = windowSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const report = await getFleetReport(admin, req.auth!.orgId!, parsed.data.from, parsed.data.to);
      res.json({ ok: true, ...report });
    }),
  );

  /**
   * The trend behind the overview (G9) — the last twelve whole months of earned, spent and kept per
   * mile, so the period on screen reads as a point on a line rather than as a verdict.
   *
   * Its own call rather than a field on `/fleet-report`: the two cover different windows, and
   * folding them together would widen every report read to a year for a chart the reader may never
   * scroll to. Twelve months is the default because that is what the page draws; the parameter
   * exists so the window is the caller's decision, as every other period on this router is.
   */
  router.get(
    "/fleet-trend",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = trendSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?to=YYYY-MM-DD&months=2..24."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const trend = await getFleetTrend(admin, req.auth!.orgId!, parsed.data.to, parsed.data.months ?? 12);
      res.json({ ok: true, ...trend });
    }),
  );

  /**
   * Revenue and activity by period (W2) — loads, revenue, billed miles and the rate between them,
   * bucketed on the day each load DELIVERED rather than the day it was invoiced.
   *
   * Weekly is the point of it: the monthly report is the P&L and stays the P&L, and what a
   * dispatcher watches between closes is how many loads went and what they were priced at. There is
   * deliberately no cost and no per-DRIVEN-mile figure here — Samsara's IFTA feed is monthly by
   * design, so a weekly driven denominator does not exist to divide by, and 26.2% of a month's cost
   * arrives as journal entries that would make three weeks look cheap and one enormous (D-FLEET10).
   */
  router.get(
    "/billing-activity",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = activityQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res
          .status(400)
          .json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD with from before to; optional: grain=day|week|month."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const f = parsed.data;
      const activity = await getBillingActivity(admin, req.auth!.orgId!, f.from, f.to, f.grain ?? "week");
      res.json({ ok: true, ...activity });
    }),
  );

  /**
   * Mileage coverage (G4 + G10) — the truck count, and whether the miles behind it are all of them.
   *
   * A page asks this before it prints a per-mile figure. Samsara telematics finished rolling out
   * across this fleet during 2026, so early months measured fewer trucks than delivered loads, and
   * a cost per mile over a short denominator reads low on miles and high on cost with nothing
   * saying so. The answer carries either a denominator or a reason, never a smaller number.
   */
  router.get(
    "/mileage-coverage",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const parsed = windowSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Provide ?from=YYYY-MM-DD&to=YYYY-MM-DD."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const coverage = await getMileageCoverage(admin, req.auth!.orgId!, parsed.data.from, parsed.data.to);
      res.json({ ok: true, ...coverage });
    }),
  );

  return router;
}
