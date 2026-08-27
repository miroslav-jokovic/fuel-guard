import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { requireFreshAuth } from "../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { runSamsaraDiagnostics } from "../modules/samsara/index.js";
import {
  getTmsIntegrationStatus,
  enableTmsIntegration,
  disableTmsIntegration,
} from "../modules/mcleod/index.js";
import {
  disableEfsSoapCredentials,
  getEfsSoapCredentials,
  getEfsSoapStatus,
  upsertEfsSoapCredentials,
} from "../modules/efs/services/efsSoapCredentials.js";
import { pingEfsSoap } from "../modules/efs/lib/efsSoap.js";
import { describeTlsMaterial } from "../modules/efs/lib/soapClient.js";
import { invalidateOrgSoapIdentity } from "../modules/efs/lib/soapCaches.js";
import { allowPrivateEndpoints, checkOutboundUrl } from "../lib/ssrfGuard.js";
import {
  ClientCertServiceError,
  activatePendingCert,
  listCerts,
  loadPendingMaterial,
  recordHandshake,
  retireAllCerts,
  rollbackToPreviousCert,
  uploadClientCert,
} from "../modules/efs/services/efsSoapClientCerts.js";
import { dispatchJob } from "../services/queue/dispatch.js";
import type { RunJobResult } from "../modules/org/index.js";
import { saveSamsaraToken, clearSamsaraToken } from "../lib/samsaraToken.js";
import { SecretBoxError } from "../lib/secretBox.js";
import { z } from "zod";
/** Standard response for a background job endpoint: 202 with the job id, or 409 when one is running.
 *  The web watches the (org, kind) ledger row via useJob(kind) for progress + the final result stats. */
function jobResponse(res: import("express").Response, result: RunJobResult): void {
  if ("conflict" in result) {
    res
      .status(409)
      .json(apiError("job_running", "That operation is already running — watch its progress."));
  } else {
    res.status(202).json({ ok: true, queued: true, jobId: result.jobId });
  }
}
export function integrationsRouter(): Router {
  const router = Router();
  router.use(requireAuth);
  const efsAdminFresh = [requireOrg, requireRole("admin"), requireFreshAuth()] as const;

  // Set / rotate the org's Samsara API token (admin). The token is SEALED at rest (secretBox, same as
  // the EFS client keys) — this fails closed with 422 when SECRETS_ENCRYPTION_KEY is not configured
  // rather than storing plaintext. The token itself is never echoed back or written to the audit log.
  router.post(
    "/samsara/token",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const parsed = z
        .object({ token: z.string().trim().min(20).max(200) })
        .safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json(apiError("bad_request", "Provide the Samsara API token as { token }."));
        return;
      }
      try {
        await saveSamsaraToken(admin, env, orgId, parsed.data.token);
      } catch (e) {
        if (e instanceof SecretBoxError && e.code === "not_configured") {
          res
            .status(422)
            .json(
              apiError(
                "secrets_key_missing",
                "SECRETS_ENCRYPTION_KEY is not configured — refusing to store the token unencrypted. Set it (openssl rand -base64 32) and retry.",
              ),
            );
          return;
        }
        throw e;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.samsara.token_set",
        entity: "integration_credentials",
        meta: { sealed: true }, // never the token
      });
      res.json({ ok: true, sealed: true });
    }),
  );

  // Remove the org's stored Samsara token (the deploy-level env fallback, if any, still applies).
  router.delete(
    "/samsara/token",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      await clearSamsaraToken(admin, orgId);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.samsara.token_cleared",
        entity: "integration_credentials",
        meta: {},
      });
      res.json({ ok: true });
    }),
  );

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
        orgId: req.auth!.orgId!,
        payload: { full: true, actorId },
        requestedBy: actorId,
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
        orgId: req.auth!.orgId!,
        payload: { actorId },
        requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // Pull idling events from Samsara into idle_events (idle tracking + driver fuel scoring). Optional body
  // { sinceDays } enables a bounded historical backfill so Phase 6 can learn from a seasonal window.
  router.post(
    "/samsara/sync-idle",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const parsed = z
        .object({ sinceDays: z.coerce.number().int().positive().max(400).optional() })
        .safeParse(req.body ?? {});
      const sinceDays = parsed.success ? parsed.data.sinceDays : undefined;
      const result = await dispatchJob(admin, env, "sync_idle", {
        orgId: req.auth!.orgId!,
        payload: { actorId, ...(sinceDays != null ? { sinceDays } : {}) },
        requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // Pull HOS duty-status logs from Samsara into hos_duty_segments (rest-vs-work context for avoidable idle).
  // Optional body { sinceDays } drives a deeper historical backfill; the scheduled run uses a rolling 30 days.
  router.post(
    "/samsara/sync-hos",
    requireOrg,
    requireRole("admin", "fleet_manager"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const actorId = req.auth!.userId;
      const raw = (req.body ?? {}) as { sinceDays?: unknown };
      const sinceDays =
        typeof raw.sinceDays === "number" && Number.isFinite(raw.sinceDays)
          ? Math.min(370, Math.max(1, Math.round(raw.sinceDays)))
          : undefined;
      const result = await dispatchJob(admin, env, "sync_hos", {
        orgId: req.auth!.orgId!,
        payload: { actorId, ...(sinceDays ? { sinceDays } : {}) },
        requestedBy: actorId,
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
        orgId: req.auth!.orgId!,
        payload: { actorId },
        requestedBy: actorId,
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
        orgId: req.auth!.orgId!,
        payload: { actorId, refreshIdle: true },
        requestedBy: actorId,
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
        orgId: req.auth!.orgId!,
        payload: { actorId },
        requestedBy: actorId,
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
  // All admin-only, org-scoped, and audited via writeAudit. Test-connection performs a real EFS login;
  // sync-now enqueues the posted or rejected date-window poll.

  router.get(
    "/efs-soap/config",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      // getEfsSoapStatus now carries the full `tls` block (description, source, active certificate
      // metadata, expiry warning) — never any key material.
      res.json(await getEfsSoapStatus(admin, env, req.auth!.orgId!));
    }),
  );

  // `endpointUrl` gets its real check from lib/ssrfGuard.ts inside the handler, not here:
  // `z.string().url()` accepts `http://169.254.169.254/` and `file:///etc/passwd` quite happily, and
  // the real check needs a DNS resolution, which a Zod schema has no business doing. See security
  // audit 2026-08-09 finding 3.8.
  const efsEnableSchema = z.object({
    environment: z.enum(["sandbox", "production"]),
    endpointUrl: z.string().url(),
    soapUsername: z.string().min(1),
    soapPassword: z.string().min(1),
    accountId: z.string().nullable().optional(),
  });

  router.post(
    "/efs-soap/enable",
    ...efsAdminFresh,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const parsed = efsEnableSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json(apiError("invalid_request", parsed.error.issues[0]?.message ?? "Invalid body"));
        return;
      }
      const input = parsed.data;
      // SSRF gate at WRITE time (audit 2026-08-09 §3.8). An org admin is a CUSTOMER, not an operator:
      // without this, "enable EFS" is a request-forgery primitive that makes our servers dial the
      // cloud metadata service or sweep the Railway private network on the poller's schedule, with the
      // HTTP status, the XML parse outcome and roundtripMs all reported back through
      // /efs-soap/test-connection. Refusing to STORE the endpoint is the cheap half of the fix — the
      // soap client re-checks before every dispatch, because rows can also arrive from elsewhere.
      const endpoint = await checkOutboundUrl(input.endpointUrl, {
        allowPrivateAddresses: allowPrivateEndpoints(env),
      });
      if (!endpoint.ok) {
        // `detail` names the address we resolved and stays in the server log; the admin gets only
        // `message`, which deliberately cannot distinguish "does not resolve" from "resolves inside
        // our network" — that distinction is itself the oracle being closed.
        console.warn(
          `[integrations] refused EFS SOAP endpoint for org ${orgId}: ${endpoint.reason} — ${endpoint.detail}`,
        );
        res.status(400).json(apiError("invalid_endpoint_url", endpoint.message));
        return;
      }
      await upsertEfsSoapCredentials(admin, env, orgId, {
        environment: input.environment,
        // Store the URL we actually validated, so no second parser can disagree about the host.
        endpointUrl: endpoint.url,
        soapUsername: input.soapUsername,
        soapPassword: input.soapPassword,
        accountId: input.accountId ?? null,
        enabled: true,
      }, req.auth!.userId);
      // Audit records the environment + username prefix — NEVER the password.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.enabled",
        entity: "efs_soap_credentials",
        meta: {
          environment: input.environment,
          endpointUrl: endpoint.url,
          usernamePrefix: input.soapUsername.slice(0, 3),
          hasAccountId: input.accountId != null,
        },
      });
      res.json({ enabled: true });
    }),
  );

  router.post(
    "/efs-soap/disable",
    ...efsAdminFresh,
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
        res
          .status(400)
          .json(apiError("efs_soap_not_configured", "EFS SOAP credentials are not set"));
        return;
      }
      const started = Date.now();
      const result = await pingEfsSoap(env, creds);
      const roundtripMs = Date.now() - started;
      // Attribute the handshake to the certificate that was actually presented, so the settings page
      // can show "last handshake OK / rejected" per certificate rather than a global integration flag.
      if (creds.tls?.source === "org" && creds.tls.certId) {
        await recordHandshake(
          admin,
          creds.tls.certId,
          result.ok,
          result.ok ? null : result.error.message,
        );
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.test_connection",
        entity: "efs_soap_credentials",
        meta: {
          ok: result.ok,
          roundtripMs,
          errorCode: result.ok ? null : result.error.code,
          tls: result.tls,
          certFingerprint: creds.tls?.fingerprintSha256 ?? null,
        },
      });
      if (result.ok) {
        res.json({ ok: true, roundtripMs, tls: result.tls });
      } else {
        // Keep the legacy response shape for clients that still understand the pre-WSDL state.
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
        orgId: req.auth!.orgId!,
        payload: { actorId },
        requestedBy: actorId,
      });
      jobResponse(res, result);
    }),
  );

  // ── EFS SOAP client certificate (mutual TLS) ──────────────────────────────────────────────────
  //   GET    /efs-soap/client-cert            — installed + historical certificates (metadata only)
  //   POST   /efs-soap/client-cert            — upload + validate; lands as PENDING, never live
  //   POST   /efs-soap/client-cert/test       — real EFS login using the PENDING certificate
  //   POST   /efs-soap/client-cert/activate   — promote pending → active, retire the incumbent
  //   POST   /efs-soap/client-cert/rollback   — restore the previously-active certificate
  //   DELETE /efs-soap/client-cert            — withdraw; falls back to env material, then plain TLS
  //
  // Admin-only and fully audited. The private key enters through POST and is never readable again by
  // any route: every response below is built from metadata columns, so there is no code path that can
  // return key material even by mistake.

  /** Map a service-layer error to the right HTTP status. Everything else bubbles to the handler. */
  function certErrorStatus(code: ClientCertServiceError["code"]): number {
    switch (code) {
      case "not_configured":
        return 503; // deployment is missing SECRETS_ENCRYPTION_KEY — not the caller's fault
      case "invalid_certificate":
        return 400;
      case "key_unreadable":
        return 500;
      default:
        return 409; // no_pending / no_active / nothing_to_roll_back — wrong state for this call
    }
  }

  const clientCertSchema = z.object({
    // Generous bounds: a PEM chain with several intermediates is legitimately a few KB, but a
    // multi-megabyte body is not a certificate.
    certPem: z.string().min(64).max(64_000),
    keyPem: z.string().min(64).max(64_000),
    passphrase: z.string().min(1).max(512).optional(),
    caPem: z.string().min(64).max(128_000).optional(),
    /** Activate immediately after upload. Off by default — stage, test, then activate. */
    activate: z.boolean().optional(),
  });

  router.get(
    "/efs-soap/client-cert",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const certs = await listCerts(admin, req.auth!.orgId!);
      res.json({
        active: certs.find((c) => c.status === "active") ?? null,
        pending: certs.find((c) => c.status === "pending") ?? null,
        history: certs.filter((c) => c.status === "retired"),
      });
    }),
  );

  router.post(
    "/efs-soap/client-cert",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const parsed = clientCertSchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json(apiError("invalid_body", parsed.error.issues[0]?.message ?? "invalid body"));
        return;
      }
      try {
        const { certPem, keyPem, passphrase, caPem, activate } = parsed.data;
        const uploaded = await uploadClientCert(
          admin,
          env,
          orgId,
          { certPem, keyPem, passphrase, caPem },
          actorId,
        );
        await writeAudit(admin, {
          orgId,
          actorId,
          action: "integration.efs_soap.client_cert_uploaded",
          entity: "efs_soap_client_certs",
          entityId: uploaded.cert.id,
          // Fingerprint + subject + expiry only. Never the key, and never the PEM.
          meta: {
            fingerprint: uploaded.cert.fingerprintSha256,
            subject: uploaded.cert.subject,
            issuer: uploaded.cert.issuer,
            notAfter: uploaded.cert.notAfter,
            warnings: uploaded.warnings,
            replacedPending: uploaded.replacedPending,
          },
        });

        if (!activate) {
          res.status(201).json({ ...uploaded, activated: false });
          return;
        }
        const promoted = await activatePendingCert(admin, orgId, actorId);
        invalidateOrgSoapIdentity(orgId);
        await writeAudit(admin, {
          orgId,
          actorId,
          action: "integration.efs_soap.client_cert_activated",
          entity: "efs_soap_client_certs",
          entityId: promoted.activated.id,
          meta: {
            fingerprint: promoted.activated.fingerprintSha256,
            replacedFingerprint: promoted.retired?.fingerprintSha256 ?? null,
            immediate: true,
          },
        });
        res
          .status(201)
          .json({ cert: promoted.activated, warnings: uploaded.warnings, activated: true });
      } catch (e) {
        if (e instanceof ClientCertServiceError) {
          res.status(certErrorStatus(e.code)).json(apiError(`efs_soap_cert_${e.code}`, e.message));
          return;
        }
        throw e;
      }
    }),
  );

  // Prove a PENDING certificate against the LIVE endpoint before it takes over. This is the whole
  // point of staging: a certificate EFS has not enrolled fails here, while the working one keeps
  // running, instead of failing after activation when there is nothing left to fall back to.
  router.post(
    "/efs-soap/client-cert/test",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const creds = await getEfsSoapCredentials(admin, env, orgId);
      if (!creds) {
        res
          .status(400)
          .json(apiError("efs_soap_not_configured", "EFS SOAP credentials are not set"));
        return;
      }
      let pending;
      try {
        pending = await loadPendingMaterial(admin, env, orgId);
      } catch (e) {
        if (e instanceof ClientCertServiceError) {
          res.status(certErrorStatus(e.code)).json(apiError(`efs_soap_cert_${e.code}`, e.message));
          return;
        }
        throw e;
      }
      if (!pending) {
        res
          .status(409)
          .json(
            apiError(
              "efs_soap_cert_no_pending",
              "No pending certificate to test — upload one first.",
            ),
          );
        return;
      }
      const result = await pingEfsSoap(env, creds, { tlsOverride: pending });
      if (pending.certId) {
        await recordHandshake(
          admin,
          pending.certId,
          result.ok,
          result.ok ? null : result.error.message,
        );
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.client_cert_tested",
        entity: "efs_soap_client_certs",
        entityId: pending.certId ?? undefined,
        meta: {
          ok: result.ok,
          fingerprint: pending.fingerprintSha256,
          tls: result.tls,
          errorCode: result.ok ? null : result.error.code,
        },
      });
      if (result.ok) {
        res.json({
          ok: true,
          roundtripMs: result.roundtripMs,
          tls: result.tls,
          fingerprint: pending.fingerprintSha256,
        });
      } else {
        res.status(502).json({
          ...apiError(`efs_soap_${result.error.code}`, result.error.message),
          tls: result.tls,
          fingerprint: pending.fingerprintSha256,
        });
      }
    }),
  );

  router.post(
    "/efs-soap/client-cert/activate",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      try {
        const promoted = await activatePendingCert(admin, orgId, req.auth!.userId);
        // Drop pooled keep-alive sockets so the very next request presents the NEW identity rather
        // than riding a connection established under the old certificate.
        invalidateOrgSoapIdentity(orgId);
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "integration.efs_soap.client_cert_activated",
          entity: "efs_soap_client_certs",
          entityId: promoted.activated.id,
          meta: {
            fingerprint: promoted.activated.fingerprintSha256,
            replacedFingerprint: promoted.retired?.fingerprintSha256 ?? null,
          },
        });
        res.json(promoted);
      } catch (e) {
        if (e instanceof ClientCertServiceError) {
          res.status(certErrorStatus(e.code)).json(apiError(`efs_soap_cert_${e.code}`, e.message));
          return;
        }
        throw e;
      }
    }),
  );

  router.post(
    "/efs-soap/client-cert/rollback",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      try {
        const rolled = await rollbackToPreviousCert(admin, orgId, req.auth!.userId);
        invalidateOrgSoapIdentity(orgId);
        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "integration.efs_soap.client_cert_rolled_back",
          entity: "efs_soap_client_certs",
          entityId: rolled.restored.id,
          meta: {
            restoredFingerprint: rolled.restored.fingerprintSha256,
            rolledBackFingerprint: rolled.rolledBack?.fingerprintSha256 ?? null,
          },
        });
        res.json(rolled);
      } catch (e) {
        if (e instanceof ClientCertServiceError) {
          res.status(certErrorStatus(e.code)).json(apiError(`efs_soap_cert_${e.code}`, e.message));
          return;
        }
        throw e;
      }
    }),
  );

  router.delete(
    "/efs-soap/client-cert",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const retired = await retireAllCerts(admin, orgId, req.auth!.userId, "withdrawn");
      invalidateOrgSoapIdentity(orgId);
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.efs_soap.client_cert_withdrawn",
        entity: "efs_soap_client_certs",
        meta: { retired },
      });
      // Report what the org falls back to, so "did I just break the integration?" is answered here.
      const creds = await getEfsSoapCredentials(admin, env, orgId);
      res.json({ retired, tls: describeTlsMaterial(creds?.tls ?? null) });
    }),
  );

  return router;
}
