import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { runSamsaraDiagnostics } from "../services/samsaraDiagnostics.js";
import { getTmsIntegrationStatus, enableTmsIntegration, disableTmsIntegration } from "../services/tmsIngest.js";
import {
  disableEfsSoapCredentials,
  getEfsSoapCredentials,
  getEfsSoapStatus,
  upsertEfsSoapCredentials,
} from "../services/efsSoapCredentials.js";
import { pingEfsSoap } from "../lib/efsSoap.js";
import { dispatchJob } from "../services/queue/dispatch.js";
import type { RunJobResult } from "../services/jobs.js";
import { z } from "zod";

/** Standard response for a background job endpoint: 202 with the job id, or 409 when one is running.
 *  The web watches the (org, kind) ledger row via useJob(kind) for progress + the final result stats. */
function jobResponse(res: import("express").Response, result: RunJobResult): void {
  if ("conflict" in result) {
    res.status(409).json(apiError("job_running", "That operation is already running — watch its progress."));
  } else {
    res.status(202).json({ ok: true, queued: true, jobId: result.jobId });
  }
}

export function integrationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Sync the fleet's identity (trucks + drivers + trailers, then idle + driver scores) from Samsara.
  // WQ1c: enqueued as a `sync_vehicles` job (payload.full → the compound refresh the card promises); the
  // worker runs it under the bounded Samsara lane (Q7). The scheduled identity tier shares this slot
  // (payload.full omitted → drivers + vehicles only), so a manual "Sync now" and a scheduled pass never
  // overlap (a conflict returns 409). The vehicle_synced audit is written by the handler (actor-gated).
  router.post(
    "/samsara/sync-vehicles",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const result = await dispatchJob(admin, env, "sync_vehicles", {
        orgId: req.auth!.orgId!, payload: { full: true, actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // Sync the org's trailers (reefer assets) from Samsara into the trailers table (admin).
  router.post(
    "/samsara/sync-trailers",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const result = await dispatchJob(admin, env, "sync_trailers", {
        orgId: req.auth!.orgId!, payload: { actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // Pull idling events from Samsara into idle_events (idle tracking + driver fuel scoring).
  router.post(
    "/samsara/sync-idle",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const result = await dispatchJob(admin, env, "sync_idle", {
        orgId: req.auth!.orgId!, payload: { actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // Sync the org's drivers from Samsara into the drivers table (admin).
  router.post(
    "/samsara/sync-drivers",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const result = await dispatchJob(admin, env, "sync_drivers", {
        orgId: req.auth!.orgId!, payload: { actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // Diagnostics: probe each Samsara endpoint and report status/counts/sample (admin, read-only). Not a
  // job — it returns its report inline for the settings screen.
  router.post(
    "/samsara/diagnostics",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      try {
        const report = await runSamsaraDiagnostics(admin, env, req.auth!.orgId!);
        res.json(report);
      } catch (e) {
        console.error("[integrations] diagnostics failed:", e);
        res.status(502).json(apiError("diagnostics_failed", "Could not run Samsara diagnostics"));
      }
    }),
  );

  // Refresh the current week's driver-performance component scores from Samsara (admin + fleet_manager).
  router.post(
    "/samsara/sync-driver-scores",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const result = await dispatchJob(admin, env, "sync_driver_scores", {
        orgId: req.auth!.orgId!, payload: { actorId, refreshIdle: true }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // Freeze all settled weeks into the rewards ledger (admin). Idempotent; DB-only (no vendor call).
  router.post(
    "/driver-performance/snapshot",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const result = await dispatchJob(admin, env, "snapshot_driver_week", {
        orgId: req.auth!.orgId!, payload: { actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // ── McLeod / TMS integration config (admin) ────────────────────────────────────────────────────────
  // Non-secret status for the settings screen (enabled? token issued? last sync?). Never returns the token.
  router.get(
    "/mcleod/config",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      res.json(await getTmsIntegrationStatus(admin, req.auth!.orgId!, "mcleod"));
    }),
  );

  // Enable + issue a fresh ingest token (also the ROTATE path — re-calling invalidates the previous token).
  // The plaintext token is returned ONCE here for the admin to paste into the on-prem agent; only its hash
  // is stored. Audited.
  router.post(
    "/mcleod/enable",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const { token, prefix } = await enableTmsIntegration(admin, orgId, "mcleod");
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.mcleod.token_issued",
        entity: "org_integrations",
        meta: { prefix },
      });
      res.json({ enabled: true, token, prefix });
    }),
  );

  // Disable + revoke the ingest token (clears the stored hash, so any live token stops working immediately).
  router.post(
    "/mcleod/disable",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      await disableTmsIntegration(admin, orgId, "mcleod");
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.mcleod.disabled",
        entity: "org_integrations",
      });
      res.json({ enabled: false });
    }),
  );

  // ── EFS SOAP integration config (admin) ────────────────────────────────────────────────────────
  // Docs: docs/plans/EFS-SOAP-INTEGRATION-PLAN.md §6.6.
  //
  // Endpoints:
  //   GET  /efs-soap/config           — non-secret status (never returns the SOAP password)
  //   POST /efs-soap/enable           — upsert credentials + enable polling
  //   POST /efs-soap/disable          — clear password + disable polling
  //   POST /efs-soap/test-connection  — one probe against EFS; returns success/failure + roundtrip
  //   POST /efs-soap/sync-now/:feed   — manual trigger for posted or rejected feed (enqueued as a job)
  //
  // All admin-only, org-scoped, and audited via writeAudit. The stubbed SOAP operations
  // (test-connection and sync-now) will surface EFS_SOAP not_implemented errors as a friendly
  // "waiting for EFS WSDL" response until data release.

  router.get(
    "/efs-soap/config",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      res.json(await getEfsSoapStatus(admin, env, req.auth!.orgId!));
    }),
  );

  const efsEnableSchema = z.object({
    environment: z.enum(["sandbox", "production"]),
    endpointUrl: z.string().url(),
    soapUsername: z.string().min(1),
    soapPassword: z.string().min(1),
    accountId: z.string().nullable().optional(),
  });

  router.post(
    "/efs-soap/enable",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const parsed = efsEnableSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid body"));
        return;
      }
      const input = parsed.data;
      await upsertEfsSoapCredentials(admin, orgId, {
        environment: input.environment,
        endpointUrl: input.endpointUrl,
        soapUsername: input.soapUsername,
        soapPassword: input.soapPassword,
        accountId: input.accountId ?? null,
        enabled: true,
      });
      // Audit records the environment + username prefix — NEVER the password.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.enabled",
        entity: "efs_soap_credentials",
        meta: {
          environment: input.environment,
          endpointUrl: input.endpointUrl,
          usernamePrefix: input.soapUsername.slice(0, 3),
          hasAccountId: input.accountId != null,
        },
      });
      res.json({ enabled: true });
    }),
  );

  router.post(
    "/efs-soap/disable",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      await disableEfsSoapCredentials(admin, orgId);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.disabled",
        entity: "efs_soap_credentials",
      });
      res.json({ enabled: false });
    }),
  );

  router.post(
    "/efs-soap/test-connection",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const creds = await getEfsSoapCredentials(admin, env, orgId);
      if (!creds) {
        res.status(400).json(apiError("efs_soap_not_configured", "EFS SOAP credentials are not set"));
        return;
      }
      const started = Date.now();
      const result = await pingEfsSoap(env, creds);
      const roundtripMs = Date.now() - started;
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.test_connection",
        entity: "efs_soap_credentials",
        meta: { ok: result.ok, roundtripMs, errorCode: result.ok ? null : result.error.code },
      });
      if (result.ok) {
        res.json({ ok: true, roundtripMs });
      } else {
        // "not_implemented" is expected pre-WSDL — return 200 with a friendly note so the UI can
        // display "Waiting on EFS WSDL" rather than "Failed".
        if (result.error.code === "not_implemented") {
          res.json({ ok: false, notImplemented: true, message: result.error.message });
        } else {
          res.status(502).json(apiError(`efs_soap_${result.error.code}`, result.error.message));
        }
      }
    }),
  );

  // Manual trigger for the posted/rejected SOAP feed. WQ1c: enqueued as the same `efs_soap_*` job the
  // poller uses (bounded SOAP lane, Q7), sharing the (org, kind) slot so a manual run and a scheduled
  // poll never overlap. The sync_now audit is written by the handler (actor-gated).
  router.post(
    "/efs-soap/sync-now/:feed",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const feedParam = String(req.params.feed);
      if (feedParam !== "posted" && feedParam !== "rejected") {
        res.status(400).json(apiError("invalid_feed", "feed must be 'posted' or 'rejected'"));
        return;
      }
      const kind = feedParam === "posted" ? "efs_soap_posted" : "efs_soap_rejected";
      const result = await dispatchJob(admin, env, kind, {
        orgId: req.auth!.orgId!, payload: { actorId }, requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  return router;
}
