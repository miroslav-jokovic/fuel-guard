import type { Request, Response, Router } from "express";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { ExportTooLargeError, MAX_EXPORT_ROWS, type CsvExport } from "../../../lib/csvExport.js";
import { exportDeclines, exportFills, fillFiltersFromQuery, readRosters } from "../fuelListExport.js";

/**
 * "Truck 654's fuel for August, as a file" — for the two lists this module owns (FUEL-P2, D-FUI15).
 *
 * ── THE GATE IS A READ'S GATE, DERIVED ──────────────────────────────────────────────────────────
 * `requireSection("fuel", "view")`, which is `spend-report.pdf`'s gate and for the same reason: an
 * export produces a document from rows the caller may already read and writes no business row. The
 * accountant and the auditor are exactly who assemble a file for somebody, and FUEL-T2's whole point
 * was that a hand-written role list beside a derived matrix is a defect (D-FUI12).
 *
 * ── THE PARAMETERS ARE THE PAGE'S OWN ───────────────────────────────────────────────────────────
 * The export takes the query string the Fuel Log is already holding — `?unit=654,696&from=…&to=…` and
 * that tab's own facets. Nothing is re-encoded on the way, so the URL that produced the screen is the
 * URL that produces the file, and a link somebody forwards can be turned into a document without
 * anybody re-deriving what it meant.
 *
 * The unit numbers and the search term are resolved against the fleet SERVER-side, through the same
 * shared functions the browser uses (`vehicleIdsForUnits`, `matchSearchIds`), rather than the browser
 * sending pre-resolved ids: a UUID list on a URL is a thing a hand-edit can point at another org's
 * trucks, and resolving it here means the org filter is applied to a set this org's roster produced.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const ymd = (v: unknown): string | null => (typeof v === "string" && YMD.test(v) ? v : null);
const uuid = (v: unknown): string | null => (typeof v === "string" && UUID.test(v) ? v : null);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : null;

/**
 * The truck list, as unit numbers.
 *
 * Capped at 500 because the parameter is public and a URL naming ten thousand units would build a
 * PostgREST filter that fails as a request-line length error rather than as anything a reader could
 * act on. The fleet is ~200 trucks; the cap is a bound on nonsense, not a product limit.
 */
const units = (v: unknown): string[] =>
  (typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean).slice(0, 500);

/** Everything the two handlers do identically: send the file, or say why it is too big. */
function sendCsv(res: Response, filename: string, out: CsvExport): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  // The BOM, so Excel reads it as UTF-8 — station and driver names carry accents, and without it the
  // first header cell arrives mangled. `downloadCsv` has always sent one from the browser.
  res.send(`\uFEFF${out.csv}`);
}

function tooLarge(res: Response, e: unknown): boolean {
  if (!(e instanceof ExportTooLargeError)) return false;
  res.status(400).json(
    apiError(
      "export_too_large",
      `${e.message} This export stops at ${MAX_EXPORT_ROWS.toLocaleString("en-US")} — narrow the window or the trucks and try again.`,
    ),
  );
  return true;
}

const scopeFor = (title: string, req: Request, trucks: number) => ({
  title,
  from: ymd(req.query.from),
  to: ymd(req.query.to),
  trucks,
  generatedAt: new Date().toISOString(),
});

export function registerFuelExportRoutes(router: Router): void {
  router.get(
    "/exports/fills.csv",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const picked = units(req.query.unit);
      const rosters = await readRosters(admin, orgId);
      const filters = fillFiltersFromQuery(
        {
          units: picked,
          from: ymd(req.query.from),
          to: ymd(req.query.to),
          driverId: uuid(req.query.driver),
          tankType: oneOf(req.query.tank, ["tractor", "reefer"] as const),
          search: str(req.query.search),
        },
        rosters,
      );

      let out: CsvExport;
      try {
        out = await exportFills(admin, { orgId, filters, scope: scopeFor("Fuel log — fills", req, picked.length) });
      } catch (e) {
        if (tooLarge(res, e)) return;
        throw e;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "export.generated",
        entity: "fuel_transactions",
        meta: { report: "fills.csv", from: ymd(req.query.from), to: ymd(req.query.to), rows: out.rows, units: picked.length },
      });
      sendCsv(res, `fuel-log-fills-${ymd(req.query.from) ?? "all"}-to-${ymd(req.query.to) ?? "all"}.csv`, out);
    }),
  );

  router.get(
    "/exports/declines.csv",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const picked = units(req.query.unit);
      const filters = {
        ...(picked.length ? { units: picked } : {}),
        ...(ymd(req.query.from) ? { from: ymd(req.query.from)! } : {}),
        ...(ymd(req.query.to) ? { to: ymd(req.query.to)! } : {}),
        ...(oneOf(req.query.risk, ["clear", "review", "alert"] as const) ? { suspicion: String(req.query.risk) } : {}),
        ...(str(req.query.error) ? { errorCode: str(req.query.error)! } : {}),
        ...(str(req.query.state) ? { state: str(req.query.state)! } : {}),
        ...(str(req.query.driver) ? { driver: str(req.query.driver)! } : {}),
        ...(str(req.query.policy) ? { policy: str(req.query.policy)! } : {}),
        ...(str(req.query.search) ? { search: str(req.query.search)! } : {}),
      };

      let out: CsvExport;
      try {
        out = await exportDeclines(admin, { orgId, filters, scope: scopeFor("Fuel log — declines", req, picked.length) });
      } catch (e) {
        if (tooLarge(res, e)) return;
        throw e;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "export.generated",
        entity: "declined_transactions",
        meta: { report: "declines.csv", from: ymd(req.query.from), to: ymd(req.query.to), rows: out.rows, units: picked.length },
      });
      sendCsv(res, `fuel-log-declines-${ymd(req.query.from) ?? "all"}-to-${ymd(req.query.to) ?? "all"}.csv`, out);
    }),
  );
}
