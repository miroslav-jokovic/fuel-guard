import type { Router } from "express";
import { requireRole, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { z } from "zod";
import { describeTlsMaterial } from "../lib/soapClient.js";
import { invalidateOrgSoapIdentity } from "../lib/soapCaches.js";
import { getEfsSoapCredentials } from "../services/efsSoapCredentials.js";
import { pingEfsSoap } from "../lib/efsSoap.js";
import {
  ClientCertServiceError,
  activatePendingCert,
  listCerts,
  loadPendingMaterial,
  recordHandshake,
  retireAllCerts,
  rollbackToPreviousCert,
  uploadClientCert,
} from "../services/efsSoapClientCerts.js";

/** The mTLS client-certificate lifecycle — upload→test→activate→rollback→withdraw. Split from
 *  integrationSoap.ts at the 500-line budget during the P1.6 route dissolution (2026-08-27);
 *  same admin+fresh-auth gate, same /api/integrations mount, paths unchanged. */
export function registerEfsSoapCertRoutes(router: Router): void {
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
}
