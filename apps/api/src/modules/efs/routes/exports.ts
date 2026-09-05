import type { Router } from "express";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { ExportTooLargeError, MAX_EXPORT_ROWS, type CsvExport } from "../../../lib/csvExport.js";
import { exportSourceRecords } from "../efsListExport.js";

/**
 * The Source-records tab, as a file (FUEL-P2, D-FUI15).
 *
 * Mounted on `/api/fueling` beside the other two fuel exports — its READERS are the people looking at
 * the Fuel Log, which is also why `registerFeedFreshnessRoutes` lives here rather than on the
 * admin-only integration router. What keeps it in THIS module is `efs_transactions`: raw collected
 * data is read by the collector that owns it (D-SEP1, `check-table-access.mjs`).
 *
 * Gate, parameters and audit are the fuel module's exports' — see `modules/fuel/routes/exports.ts` for
 * the argument. One shape for all three, or the section grows two ways to ask the same question.
 */

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const ymd = (v: unknown): string | null => (typeof v === "string" && YMD.test(v) ? v : null);
const units = (v: unknown): string[] =>
  (typeof v === "string" ? v.split(",") : []).map((s) => s.trim()).filter(Boolean).slice(0, 500);

export function registerEfsExportRoutes(router: Router): void {
  router.get(
    "/exports/source-records.csv",
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
        ...(str(req.query.item) ? { item: str(req.query.item)! } : {}),
        ...(str(req.query.state) ? { state: str(req.query.state)! } : {}),
        ...(str(req.query.driver) ? { driver: str(req.query.driver)! } : {}),
        ...(str(req.query.search) ? { search: str(req.query.search)! } : {}),
      };

      let out: CsvExport;
      try {
        out = await exportSourceRecords(admin, {
          orgId,
          filters,
          scope: {
            title: "Fuel log — source records",
            from: ymd(req.query.from),
            to: ymd(req.query.to),
            trucks: picked.length,
            generatedAt: new Date().toISOString(),
          },
        });
      } catch (e) {
        if (e instanceof ExportTooLargeError) {
          res.status(400).json(
            apiError(
              "export_too_large",
              `${e.message} This export stops at ${MAX_EXPORT_ROWS.toLocaleString("en-US")} — narrow the window or the trucks and try again.`,
            ),
          );
          return;
        }
        throw e;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "export.generated",
        entity: "efs_transactions",
        meta: { report: "source-records.csv", from: ymd(req.query.from), to: ymd(req.query.to), rows: out.rows, units: picked.length },
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fuel-log-source-records-${ymd(req.query.from) ?? "all"}-to-${ymd(req.query.to) ?? "all"}.csv"`,
      );
      // The BOM, so Excel reads it as UTF-8 — station names carry accents.
      res.send(`\uFEFF${out.csv}`);
    }),
  );
}
