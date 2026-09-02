import type { Router } from "express";
import { requireRole, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob, jobResponse } from "../../../queue/dispatch.js";
import { z } from "zod";
import { SecretBoxError } from "../../../lib/secretBox.js";
import { saveSamsaraToken, clearSamsaraToken } from "../lib/samsaraToken.js";
import { runSamsaraDiagnostics } from "../samsaraDiagnostics.js";
import { readSamsaraWebhookStatus } from "../fuelEventsWebhook.js";
import { readTelematicsCoverage } from "../telematicsCoverage.js";
import { rolesThatCanView } from "@silvicom/shared";

/** Samsara integration admin routes — token set/rotate/clear, the manual sync buttons, and the
 *  diagnostics probe. Moved here from routes/integrations.ts at the P1.6 split (2026-08-27): the
 *  collector owns its credential surface and its sync triggers. Mounted on the shared
 *  /api/integrations router; every path is unchanged (including /samsara/sync-driver-scores,
 *  which dispatches the performance module's job kind but keeps its historical URL). */
export function registerSamsaraIntegrationRoutes(router: Router): void {
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

  /**
   * Webhook readiness (read-only) — is the receiver configured, and has it EVER received anything?
   *
   * S1's actual subject. The two live defects it reports around — a vendor webhook pointed at
   * `/api/webhooks` instead of the mounted path, and an unset `SAMSARA_WEBHOOK_SECRET` making the
   * receiver 401 everything — are both fixed in the Samsara console and in Railway, not here. What
   * WAS a code defect is that neither was visible from inside the product: `fuel_events` sat at 0 rows
   * for six months and no screen said whether that meant "no theft" or "no receiver".
   *
   * The gate is derived (`rolesThatCanView("settings")`), not hand-listed, per CLAUDE.md — this file's
   * older `requireRole("admin")` writes are the surface T2 generalises and are left alone here.
   */
  router.get(
    "/samsara/webhook",
    requireOrg,
    requireRole(...rolesThatCanView("settings")),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      res.json(await readSamsaraWebhookStatus(admin, env, req.auth!.orgId!));
    }),
  );

  /**
   * How much of this carrier's fuel history the collector has corroborated, per month (SAM-S4).
   *
   * ⚠ ALL-TIME by construction, with no window parameter — D-SAM7. The Coverage page computes the
   * same idea over 90 days and reads ~95%; measured against the whole history the figure was 23%.
   * Giving this route a window would re-create exactly the reassuring answer it exists to replace.
   *
   * Gate is derived (`rolesThatCanView("settings")`), not hand-listed, per CLAUDE.md.
   */
  router.get(
    "/samsara/telematics-coverage",
    requireOrg,
    requireRole(...rolesThatCanView("settings")),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      res.json(await readTelematicsCoverage(admin, req.auth!.orgId!));
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

}
