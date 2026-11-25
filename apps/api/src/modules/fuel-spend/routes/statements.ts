import { isRecordId } from "@silvicom/shared";
import type { Request, Response, Router } from "express";
import { requireSection, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { type StatementWord } from "@silvicom/shared";
import { ingestFuelStatement, STATEMENT_BUCKET } from "../fuelStatementIngest.js";
import { runFuelReconciliation } from "../fuelReconRun.js";
import { listReconRuns, readReconRun } from "../reconRunRead.js";
import { readWeeklyBill } from "../weeklyBillRead.js";
import { weeklyBillWorkbook } from "../weeklyBillWorkbook.js";
import { readPilotBillMails } from "../pilotBillMail.js";
import { recheckFuelStatement } from "../fuelStatementRecheck.js";
import type { ReconRunResult } from "../fuelReconRun.js";
import type { SupabaseClient } from "@supabase/supabase-js";

/** One audit row per recorded check, from either door (an upload or "Check again"). */
async function auditReconRun(req: Request, admin: SupabaseClient, result: ReconRunResult, extra: Record<string, unknown> = {}): Promise<void> {
  const s = result.result!.summary;
  await writeAudit(admin, {
    orgId: req.auth!.orgId!,
    actorId: req.auth!.userId,
    action: "fuel.recon_run",
    entity: "fuel_recon_runs",
    entityId: result.runId,
    // The data-quality counts ride along: they are what somebody will want to explain a moved
    // figure with, and the run row itself is append-only so this is the only place they can grow.
    meta: {
      kind: result.invoiceNo ? "weekly_statement" : "monthly_export",
      invoice: result.invoiceNo, from: result.periodStart, to: result.periodEnd,
      gated: result.tieOutGated,
      clean: s.clean, dateDrift: s.dateDrift,
      missingInSystem: s.missingInSystem, missingOnReport: s.missingOnReport,
      exposure: s.exposure,
      carried: result.carried ?? null,
      ...extra,
    },
  });
}


/** Statement + reconciliation routes — moved here from routes/fueling/networks.ts at the P1.6
 *  split (2026-08-27): fuel_statements, fuel_recon_runs and the statement bucket are this
 *  module's tables, so their routes live with the owner. Mounted on the shared /api/fueling
 *  router; paths are unchanged. */
/** Gates derived from `SECTION_ACCESS`, never listed — FUEL-T2/D-FUI12; the argument is in
 *  routes/exceptions.ts. Recording a statement or a reconciliation stays with the manage set. */
export function registerStatementRoutes(router: Router): void {
  // Record a weekly Pilot direct-bill statement. The browser decodes the PDF (only it has pdfjs) and
  // sends the positioned WORDS plus the original bytes; the server re-parses and refuses anything that
  // does not reproduce the statement's own printed totals, so a browser can never assert a statement.
  router.post(
    "/statements",
    requireOrg,
    requireSection("fuel"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const body = req.body as { words?: unknown; filename?: unknown; sourceBase64?: unknown };
      if (!Array.isArray(body?.words) || body.words.length === 0) {
        res.status(400).json(apiError("bad_request", "Expected { words: StatementWord[] } from the decoded PDF."));
        return;
      }
      const result = await ingestFuelStatement(admin, req.auth!.orgId!, req.auth!.userId, {
        words: body.words as StatementWord[],
        filename: typeof body.filename === "string" ? body.filename : null,
        sourceBase64: typeof body.sourceBase64 === "string" ? body.sourceBase64 : null,
      });
      if (!result.ok) {
        // Logged as well as returned. Until 2026-11-24 a refused save was a toast and nothing else, and
        // production holds ZERO statements beside nine checks of the same invoices — nobody could say why
        // (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24, progress log). One line per refusal, no line content.
        console.warn(`[fuel-statement] refused for org ${req.auth!.orgId}: ${result.error ?? "?"}${result.tieOutFailures?.length ? ` — ${result.tieOutFailures.join(" | ")}` : ""}`);
        // The tie-out failures travel with the error on purpose: "the statement didn't add up" is
        // useless to the person holding the PDF, "fuel total $x vs the printed $y" is actionable.
        res.status(422).json({
          ...apiError("statement_rejected", result.error ?? "Could not record the statement"),
          tieOutFailures: result.tieOutFailures ?? [],
        });
        return;
      }
      res.json(result);
    }),
  );

  /**
   * Reconcile a vendor report against our own fills, and RECORD the finding (F5, migration 0249).
   *
   * The browser decodes the container and sends words (PDF) or the cell grid (export); the server
   * re-parses, gates, matches and writes. `fuel_recon_runs` has no client write policy, so this is the
   * only way a reconciliation can exist — a browser cannot assert one (D-FX1).
   */
  router.post(
    "/recon-runs",
    requireOrg,
    requireSection("fuel"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const body = req.body as {
        words?: unknown; grid?: unknown; pivotGrid?: unknown; filename?: unknown; statementId?: unknown;
      };
      const result = await runFuelReconciliation(admin, req.auth!.orgId!, req.auth!.userId, {
        words: Array.isArray(body?.words) ? (body.words as StatementWord[]) : null,
        grid: Array.isArray(body?.grid) ? (body.grid as unknown[][]) : null,
        pivotGrid: Array.isArray(body?.pivotGrid) ? (body.pivotGrid as unknown[][]) : null,
        filename: typeof body?.filename === "string" ? body.filename : null,
        statementId: typeof body?.statementId === "string" ? body.statementId : null,
      });
      if (!result.ok) {
        // The gate's reasons travel with the refusal, for the same reason the statement route does it:
        // "the export didn't add up" is useless to the person holding the file; "diesel gallons read
        // 418,530 against the 418,537 its own PivotTable prints" is actionable.
        res.status(422).json({
          ...apiError("recon_rejected", result.error ?? "Could not reconcile that report"),
          tieOutFailures: result.tieOutFailures ?? [],
        });
        return;
      }
      await auditReconRun(req, admin, result);
      res.json(result);
    }),
  );

  /**
   * "Check again" (PILOT-INVOICE-FORMAT-ANALYSIS §5): re-run a recorded weekly bill's check from the PDF we
   * kept, with today's reader (`fuelStatementRecheck.ts`). The manage set, like recording a check — it
   * writes a run and closes findings.
   */
  router.post(
    "/statements/:id/recheck",
    requireOrg,
    requireSection("fuel"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      if (!isRecordId(id)) {
        res.status(404).json(apiError("not_found", "No statement with that id."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const r = await recheckFuelStatement(admin, req.auth!.orgId!, req.auth!.userId, id);
      if (!r.ok) {
        res.status(r.status).json({ ...apiError(r.code, r.message), tieOutFailures: r.tieOutFailures ?? [] });
        return;
      }
      await auditReconRun(req, admin, r.run, { recheckOf: id });
      res.json(r.run);
    }),
  );

  // The weekly bills the API pulled from the Pilot-Bills folder itself (PILOT-INVOICE-FORMAT-ANALYSIS §4): what
  // became of each recent email — recorded (and which invoice), a duplicate, refused and why, or no PDF. The
  // fuel section's VIEW set, the gate of the invoice checks it sits above.
  router.get(
    "/statements/mail",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json({ mails: await readPilotBillMails(admin, req.auth!.orgId!) });
    }),
  );

  /**
   * The saved checks, newest period first, paged (FS3). Superseded ones are history, not a finding to
   * act on, and are not listed. This read used to stop at `.limit(100)` and say nothing; `total` lets
   * the Pilot invoices page say how many there are and page past any cap.
   */
  router.get(
    "/recon-runs",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const r = await listReconRuns(admin, req.auth!.orgId!, {
        limit: Number(req.query.limit) || 25,
        offset: Number(req.query.offset) || 0,
      });
      if (!r.ok) {
        dbErrorResponse(res, "fuel_recon_runs read", r.error, "Could not load your invoice checks");
        return;
      }
      res.json({ ok: true, ...r.page });
    }),
  );

  /** One saved check and the lines it recorded, read back as written (FS3). */
  router.get(
    "/recon-runs/:id",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const id = String(req.params.id);
      // Not a uuid is not a run: Postgres would answer 22P02 and the reader would see a 500.
      if (!isRecordId(id)) {
        res.status(404).json(apiError("not_found", "No invoice check with that id."));
        return;
      }
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const r = await readReconRun(admin, req.auth!.orgId!, id);
      if (!r.ok) {
        dbErrorResponse(res, "fuel_recon_runs read", r.error, "Could not load that invoice check");
        return;
      }
      if (!r.detail) {
        res.status(404).json(apiError("not_found", "No invoice check with that id."));
        return;
      }
      res.json({ ok: true, ...r.detail });
    }),
  );

  /**
   * A recorded weekly bill rebuilt in the old statement's columns, with the discount and the quote check
   * Pilot's 2026-11 invoice no longer prints (`weeklyBillRead.ts`). JSON for the page, `.xlsx` for the
   * office's spreadsheet. The fuel section's VIEW set, the gate of the check it belongs to; the workbook is
   * audited as `export.generated`, as every fuel export is.
   */
  // Two literal paths rather than a loop: `routeGates.test.ts` reads each route's gate from its source.
  const weeklyBill = (format: "json" | "xlsx") => async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params.id);
    if (!isRecordId(id)) {
      res.status(404).json(apiError("not_found", "No statement with that id."));
      return;
    }
    const admin = getSupabaseAdmin(getAppLocals(req).env);
    const r = await readWeeklyBill(admin, req.auth!.orgId!, id);
    if (!r.ok) {
      if (r.notFound) res.status(404).json(apiError("not_found", "No statement with that id."));
      else dbErrorResponse(res, "fuel_statements read", { message: r.error }, "Could not load that statement");
      return;
    }
    if (format === "json") {
      res.json({ ok: true, statement: r.statement, report: r.report });
      return;
    }
    const bytes = await weeklyBillWorkbook(r.statement, r.report);
    await writeAudit(admin, {
      orgId: req.auth!.orgId!, actorId: req.auth!.userId, action: "export.generated",
      entity: "fuel_statements", entityId: id,
      meta: { report: "weekly-bill.xlsx", invoice: r.statement.invoiceNo, rows: r.report.rows.length, overQuote: r.report.overQuote.length },
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="pilot-${r.statement.invoiceNo}-${r.statement.periodStart}-old-columns.xlsx"`);
    res.send(bytes);
  };
  router.get("/statements/:id/weekly-bill", requireOrg, requireSection("fuel", "view"), asyncHandler(weeklyBill("json")));
  router.get("/statements/:id/weekly-bill.xlsx", requireOrg, requireSection("fuel", "view"), asyncHandler(weeklyBill("xlsx")));

  // The original PDF behind a statement. Served as a short-lived signed URL rather than a public
  // object: the bucket has no client policies at all, so this route is the only door, and it re-checks
  // the caller's org before issuing one — the service role bypasses RLS.
  router.get(
    "/statements/:id/source",
    requireOrg,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const { data } = await admin
        .from("fuel_statements")
        .select("source_path")
        .eq("org_id", req.auth!.orgId!)
        .eq("id", req.params.id)
        .maybeSingle();
      const path = (data as { source_path: string | null } | null)?.source_path;
      if (!path) {
        res.status(404).json(apiError("not_found", "No source document was stored for that statement."));
        return;
      }
      const signed = await admin.storage.from(STATEMENT_BUCKET).createSignedUrl(path, 300);
      if (signed.error || !signed.data?.signedUrl) {
        res.status(502).json(apiError("storage_unavailable", "Could not open the stored statement."));
        return;
      }
      res.json({ url: signed.data.signedUrl });
    }),
  );
}
