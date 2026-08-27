import type { Router } from "express";
import { requireRole, requireOrg } from "../../middleware/auth.js";
import { apiError, asyncHandler } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { buildFuelSpendRollup } from "../../services/fuelSpendRollup.js";
import { resolveFuelTransactionStations } from "../../services/fuelStationResolve.js";
import { renderFuelSpendReport } from "../../services/fuelSpendReport.js";
import type { SpendGrain } from "@silvicom/shared";

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const GRAINS = new Set(["day", "week", "month"]);

export function registerSpendRoutes(router: Router): void {
  // The report as a document, for somebody who will not open the app. Rendered on the server from the
  // rollup rather than from whatever the browser is showing: a figure in a PDF gets quoted back months
  // later, so it comes from the same pure functions the page uses and cannot disagree with it.
  router.get(
    "/spend-report.pdf",
    requireOrg,
    requireRole("admin", "fleet_manager", "dispatcher"),
    asyncHandler(async (req, res) => {
      const from = typeof req.query.from === "string" ? req.query.from : "";
      const to = typeof req.query.to === "string" ? req.query.to : "";
      const grain = typeof req.query.grain === "string" && GRAINS.has(req.query.grain) ? (req.query.grain as SpendGrain) : "week";
      if (!YMD.test(from) || !YMD.test(to) || to < from) {
        res.status(400).json(apiError("bad_request", "Expected from and to as YYYY-MM-DD dates, earliest first."));
        return;
      }

      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      // Same filters the screen was showing. A UUID list is validated rather than passed through: it
      // reaches `.in()` on a service-role query, where the org filter is the only tenant boundary.
      const vehicleIds = (typeof req.query.vehicles === "string" ? req.query.vehicles.split(",") : [])
        .map((v) => v.trim())
        .filter((v) => UUID.test(v));

      // The org's own idle burn rate, so the document and the Idling page cost an idle hour identically.
      const { data: idleCfg } = await admin
        .from("idle_settings").select("idle_gal_per_hour").eq("org_id", orgId).maybeSingle();
      const rate = (idleCfg as { idle_gal_per_hour?: number | string } | null)?.idle_gal_per_hour;

      const { pdf, periods } = await renderFuelSpendReport(admin, {
        orgId, from, to, grain, vehicleIds,
        idleGalPerHour: rate == null ? undefined : Number(rate) || undefined,
        generatedAt: new Date().toISOString(),
      });

      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "export.generated",
        entity: "fuel_spend_days", meta: { report: "spend-report.pdf", from, to, grain, periods, vehicles: vehicleIds.length },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="fuelguard-fuel-spend-${from}-to-${to}.pdf"`);
      res.send(pdf);
    }),
  );

  // Point fills at the station they were bought from. The nightly sweep does this for whatever is
  // still unresolved; this endpoint exists to seed history, and to re-resolve EVERYTHING after a change
  // to the matcher, which the sweep deliberately will not do on its own.
  router.post(
    "/station-resolve",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const all = (req.body as { all?: unknown })?.all === true;
      const result = await resolveFuelTransactionStations(admin, orgId, { onlyUnresolved: !all });
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "fuel.station_resolve",
        entity: "fuel_transactions",
        meta: { all, scanned: result.scanned, resolved: result.resolved, updates: result.updates, byReason: result.byReason },
      });
      res.json({ ok: true, ...result });
    }),
  );

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
