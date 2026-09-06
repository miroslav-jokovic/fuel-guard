import type { Router } from "express";
import { requireOrg, requireSection } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { ExportTooLargeError, MAX_EXPORT_ROWS, type CsvExport } from "../../../lib/csvExport.js";
import { exportSourceRecords } from "../efsListExport.js";
import { exportCards } from "../efsCardExport.js";

/**
 * The two lists this collector owns, as files (FUEL-P2, D-FUI15) — the Source-records tab and the
 * card inventory.
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

  /**
   * The card inventory (FUEL-P2).
   *
   * ⚠ No `unit` parameter, and that is the Q-FUI14 ruling applied a second time. The Cards page's
   * `?unit=` is a card's PROMPT — the unit a driver types at the pump — not a truck the row belongs
   * to, so it travels as one of the seven in-memory facets rather than as this section's shared truck
   * filter. The scope line therefore says "all trucks" always, because a card list is not scoped by
   * truck at all; inventing a truck count here would be a different fact wearing the same sentence's
   * clothes.
   */
  router.get(
    "/exports/cards.csv",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      let out: CsvExport;
      try {
        out = await exportCards(admin, {
          orgId,
          status: str(req.query.status),
          search: str(req.query.search),
          filters: {
            ...(str(req.query.driver) ? { driver: str(req.query.driver)! } : {}),
            ...(str(req.query.unit) ? { unit: str(req.query.unit)! } : {}),
            ...(str(req.query.policy) ? { policy: str(req.query.policy)! } : {}),
            ...(str(req.query.override) ? { override: str(req.query.override)! } : {}),
            ...(str(req.query.linked) ? { linked: str(req.query.linked)! } : {}),
            ...(str(req.query.health) ? { health: str(req.query.health)! } : {}),
          },
          scope: { title: "Fuel cards", from: null, to: null, trucks: 0, generatedAt: new Date().toISOString() },
        });
      } catch (e) {
        if (e instanceof ExportTooLargeError) {
          res.status(400).json(
            apiError(
              "export_too_large",
              `${e.message} This export stops at ${MAX_EXPORT_ROWS.toLocaleString("en-US")} — narrow the filters and try again.`,
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
        entity: "efs_cards",
        meta: { report: "cards.csv", rows: out.rows, status: str(req.query.status) },
      });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="fuel-cards-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send(`\uFEFF${out.csv}`);
    }),
  );
}
