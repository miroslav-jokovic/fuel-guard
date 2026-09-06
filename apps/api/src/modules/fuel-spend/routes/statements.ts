import type { Router } from "express";
import { requireSection, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, dbErrorResponse } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { type StatementWord } from "@silvicom/shared";
import { ingestFuelStatement, STATEMENT_BUCKET } from "../fuelStatementIngest.js";
import { runFuelReconciliation } from "../fuelReconRun.js";

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
        },
      });
      res.json(result);
    }),
  );

  /** The runs we hold, newest period first. Superseded ones are history, not a finding to act on. */
  router.get(
    "/recon-runs",
    requireOrg,
    requireSection("fuel", "view"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const { data, error } = await admin
        .from("fuel_recon_runs")
        .select("id, source_kind, source_filename, invoice_no, period_start, period_end, tie_out_gated, tie_out_notes, matcher_version, summary, unmatchable_lines, created_at")
        .eq("org_id", req.auth!.orgId!)
        .is("superseded_by", null)
        .order("period_start", { ascending: false })
        .limit(100);
      if (error) {
        dbErrorResponse(res, "fuel_recon_runs read", error, "Could not load your reconciliations");
        return;
      }
      res.json({ ok: true, runs: data ?? [] });
    }),
  );

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
