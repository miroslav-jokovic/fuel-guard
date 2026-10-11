import type { Router } from "express";
import { requireSection, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { FUEL_NETWORKS, parseYmd, windowDays, type FuelNetwork } from "@silvicom/shared";
import { writeAudit } from "../../../lib/audit.js";
import { readFuelReport, type FuelReportFilterArgs } from "../fuelReport.js";
import { renderFuelCostsReport } from "../fuelCostsReport.js";

/**
 * A year, plus a day so a leap year's full year fits. The previous range doubles what is read, and each
 * range is one `fuel_spend_lines` pass (838 ms per 90 days measured 2026-10-02) — so the bound keeps
 * each call well inside the statement timeout rather than trusting whatever the URL asks for.
 */
const MAX_WINDOW_DAYS = 366;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE = /^[A-Z]{2}$/;

const list = (v: unknown): string[] =>
  (typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean);

export type ReportQuery =
  | { ok: true; from: string; to: string; filters: FuelReportFilterArgs }
  | { ok: false; message: string };

/**
 * The report's query string, validated. Shared by `GET /report` and `GET /report.pdf`, because the document
 * must be asked for with EXACTLY the filters the screen sends and refused for exactly the same bad values
 * (Q-FSV14): a second parser is how the PDF would come to accept a state the screen's report rejects.
 */
export function parseReportQuery(query: Record<string, unknown>): ReportQuery {
  const from = parseYmd(query.from);
  const to = parseYmd(query.to);
  if (from == null || to == null || to < from) return { ok: false, message: "Expected from and to as YYYY-MM-DD dates, earliest first." };
  if (windowDays(from, to) > MAX_WINDOW_DAYS) return { ok: false, message: `Pick a range of at most ${MAX_WINDOW_DAYS} days.` };

  const raw = {
    vehicles: list(query.vehicles),
    states: list(query.states).map((s) => s.toUpperCase()),
    sites: list(query.sites),
    networks: list(query.networks),
  };
  const filters: FuelReportFilterArgs = {
    vehicleIds: raw.vehicles.filter((v) => UUID.test(v)),
    states: raw.states.filter((s) => STATE.test(s)),
    siteIds: raw.sites.filter((v) => UUID.test(v)),
    networks: raw.networks.filter((x): x is FuelNetwork => (FUEL_NETWORKS as readonly string[]).includes(x)),
  };
  const dropped =
    raw.vehicles.length - filters.vehicleIds.length + (raw.states.length - filters.states.length) +
    (raw.sites.length - filters.siteIds.length) + (raw.networks.length - filters.networks.length);
  if (dropped > 0) {
    return { ok: false, message: "A filter value was not recognised: vehicles and sites are ids, states two letters, networks in/out/unknown." };
  }
  return { ok: true, from, to, filters };
}

/**
 * `GET /api/fueling/report` — the Fuel Costs report (FS1; the page is FS2).
 *
 * Every list filter is VALIDATED, never passed through: each reaches a service-role query where the
 * org filter is the only tenant boundary, and an unrecognised value is dropped rather than turned into
 * a filter that matches nothing. A request whose every value was dropped is answered unfiltered, so it
 * is refused instead — "you asked for something I can't read" beats a fleet total under a filter label.
 *
 * A read, so it takes the fuel section's VIEW set (derived from `SECTION_ACCESS`, FUEL-T2/D-FUI12).
 */
export function registerReportRoutes(router: Router): void {
  router.get(
    "/report",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const q = parseReportQuery(req.query);
      if (!q.ok) {
        res.status(400).json(apiError("bad_request", q.message));
        return;
      }
      const { from, to, filters } = q;
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await readFuelReport(admin, req.auth!.orgId!, from, to, filters));
    }),
  );

  /**
   * `GET /api/fueling/report.pdf` — the Fuel Costs screen as a document (FS-PDF, Q-FSV14 option a).
   *
   * Takes the screen's own query string and validates it with the screen's own parser, then renders from the
   * same `readFuelReport`, so the file carries every filter the page had (the older `spend-report.pdf` took
   * dates, grain and trucks only) and compares the same two ranges. A read, so the fuel view set; the export
   * is audited, as the older one is, because a figure in a PDF is quoted back months later.
   */
  router.get(
    "/report.pdf",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const q = parseReportQuery(req.query);
      if (!q.ok) {
        res.status(400).json(apiError("bad_request", q.message));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { pdf, pages } = await renderFuelCostsReport(admin, orgId, q.from, q.to, q.filters, new Date().toISOString());
      await writeAudit(admin, {
        orgId, actorId: req.auth!.userId, action: "export.generated",
        entity: "fuel_report_days",
        meta: {
          report: "report.pdf", from: q.from, to: q.to, pages,
          vehicles: q.filters.vehicleIds.length, states: q.filters.states.length,
          sites: q.filters.siteIds.length, networks: q.filters.networks.length,
        },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="silvicom-fuel-costs-${q.from}-to-${q.to}.pdf"`);
      res.send(pdf);
    }),
  );
}
