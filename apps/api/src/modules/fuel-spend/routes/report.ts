import type { Router } from "express";
import { requireSection, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { FUEL_NETWORKS, parseYmd, windowDays, type FuelNetwork } from "@silvicom/shared";
import { readFuelReport } from "../fuelReport.js";

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
      const from = parseYmd(req.query.from);
      const to = parseYmd(req.query.to);
      if (from == null || to == null || to < from) {
        res.status(400).json(apiError("bad_request", "Expected from and to as YYYY-MM-DD dates, earliest first."));
        return;
      }
      if (windowDays(from, to) > MAX_WINDOW_DAYS) {
        res.status(400).json(apiError("bad_request", `Pick a range of at most ${MAX_WINDOW_DAYS} days.`));
        return;
      }

      const raw = {
        vehicles: list(req.query.vehicles),
        states: list(req.query.states).map((s) => s.toUpperCase()),
        sites: list(req.query.sites),
        networks: list(req.query.networks),
      };
      const filters = {
        vehicleIds: raw.vehicles.filter((v) => UUID.test(v)),
        states: raw.states.filter((s) => STATE.test(s)),
        siteIds: raw.sites.filter((v) => UUID.test(v)),
        networks: raw.networks.filter((x): x is FuelNetwork => (FUEL_NETWORKS as readonly string[]).includes(x)),
      };
      const dropped =
        raw.vehicles.length - filters.vehicleIds.length +
        (raw.states.length - filters.states.length) +
        (raw.sites.length - filters.siteIds.length) +
        (raw.networks.length - filters.networks.length);
      if (dropped > 0) {
        res.status(400).json(apiError("bad_request", "A filter value was not recognised: vehicles and sites are ids, states two letters, networks in/out/unknown."));
        return;
      }

      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await readFuelReport(admin, req.auth!.orgId!, from, to, filters));
    }),
  );
}
