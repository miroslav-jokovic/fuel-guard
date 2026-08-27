import type { Router } from "express";
import { requireRole, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob, jobResponse } from "../../../queue/dispatch.js";
import { z } from "zod";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import {
  disableEfsSoapCredentials,
  getEfsSoapCredentials,
  getEfsSoapStatus,
  upsertEfsSoapCredentials,
} from "../services/efsSoapCredentials.js";
import { pingEfsSoap } from "../lib/efsSoap.js";
import { recordHandshake } from "../services/efsSoapClientCerts.js";
import { allowPrivateEndpoints, checkOutboundUrl } from "../../../lib/ssrfGuard.js";

/** EFS SOAP integration config — the collector's own credential surface, moved here from
 *  routes/integrations.ts at the P1.6 split (2026-08-27). Paths unchanged; the mTLS
 *  client-cert lifecycle lives in integrationSoapCerts.ts (500-line budget). Docs:
 *  docs/plans/EFS-SOAP-INTEGRATION-PLAN.md §6.6. */
export function registerEfsSoapIntegrationRoutes(router: Router): void {
  const efsAdminFresh = [requireOrg, requireRole("admin"), requireFreshAuth()] as const;
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

}
