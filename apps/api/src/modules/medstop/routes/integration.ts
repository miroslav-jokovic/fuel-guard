import type { Request, Response, Router } from "express";
import { medstopApiKeySchema, medstopOrderingSchema, type MedstopConnectionStatus } from "@silvicom/shared";
import { requireOrg, requireAdminOnly } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob, jobResponse } from "../../../queue/dispatch.js";
import { getCredential, setApiKey, setEnabled, setOrdering } from "../credentials.js";
import { probeApiKey } from "../probe.js";
import { MEDSTOP_SYNC_HOURS } from "../scheduler.js";

/**
 * The Med-Stop connection door — FleetPal's (`fleetpal/routes/integration.ts`) in shape: admin-only
 * by name, audited, never echoing key material; storing a key and switching the sweep on take a
 * fresh sign-in, switching it off does not (a kill switch that asks for a password first is one an
 * admin cannot pull in a hurry).
 *
 * The probe runs FROM THIS SERVICE, which matters more here than for FleetPal: Med-Stop's key is
 * IP-bound to the api service's egress (D-MS3), so a key that works from a laptop can still be
 * refused here, and only a probe from here can say so before it is stored.
 */
export function registerMedstopIntegrationRoutes(router: Router): void {
  const adminOnly = [requireOrg, requireAdminOnly("medstop.connection")] as const;

  router.get(
    "/medstop/config",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const credential = await getCredential(getSupabaseAdmin(env), req.auth!.orgId!);
      const body: MedstopConnectionStatus = {
        hasKey: credential?.hasKey ?? false,
        enabled: credential?.enabled ?? false,
        schedulerOn: env.MEDSTOP_SYNC_ENABLED === true,
        syncHours: MEDSTOP_SYNC_HOURS,
        keyExpiresOn: credential?.keyExpiresOn ?? null,
        lastSyncedAt: credential?.lastSyncedAt ?? null,
        lastError: credential?.lastError ?? null,
        ordersEnabled: credential?.ordersEnabled ?? false,
        orderContactEmail: credential?.orderContactEmail ?? null,
        orderContactPhone: credential?.orderContactPhone ?? null,
      };
      res.json(body);
    }),
  );

  router.post(
    "/medstop/key",
    ...adminOnly,
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const parsed = medstopApiKeySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Paste the Med-Stop API key as { apiKey, expiresOn }."));
        return;
      }
      const baseUrl = (await getCredential(admin, orgId))?.baseUrl ?? "https://api.med-stop.com";
      const probe = await probeApiKey(parsed.data.apiKey, baseUrl);
      if (!probe.ok) {
        const refused = probe.kind === "auth" || probe.kind === "forbidden" || probe.kind === "ip_refused";
        res.status(refused ? 400 : 502).json(apiError(refused ? "medstop_key_refused" : "medstop_unreachable", refusalText(probe.kind, probe.message)));
        return;
      }
      const stored = await setApiKey(admin, env, orgId, parsed.data.apiKey, parsed.data.expiresOn ?? null);
      if ("error" in stored) {
        res.status(422).json(apiError("medstop_key_not_stored", stored.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.medstop.key_set",
        entity: "medstop_credentials",
        meta: { sealed: true, probeMs: probe.ms, expiresOn: parsed.data.expiresOn ?? null }, // never the key
      });
      res.json({ ok: true, probeMs: probe.ms });
    }),
  );

  router.post("/medstop/enable", ...adminOnly, requireFreshAuth(), asyncHandler(async (req, res) => toggle(req, res, true)));
  router.post("/medstop/disable", ...adminOnly, asyncHandler(async (req, res) => toggle(req, res, false)));

  // UX3: ordering on/off and the office contact. Turning ordering ON asks for a fresh sign-in, like
  // storing the key — from then on any of the three order roles can place a billed order. Turning it
  // off does not: an off switch must never ask for a password first.
  router.post(
    "/medstop/ordering",
    ...adminOnly,
    asyncHandler(async (req, res, next) => {
      const parsed = medstopOrderingSchema.safeParse(req.body ?? {});
      if (!parsed.success) return void res.status(400).json(apiError("bad_request", parsed.error.issues[0]?.message ?? "Check the ordering settings."));
      res.locals.ordering = parsed.data;
      if (parsed.data.enabled) return requireFreshAuth()(req, res, next);
      next();
    }),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const ordering = res.locals.ordering as { enabled: boolean; email: string | null; phone: string | null };
      const before = await getCredential(admin, orgId);
      const saved = await setOrdering(admin, orgId, ordering);
      if ("error" in saved) return void res.status(502).json(apiError("db_error", saved.error));
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: ordering.enabled ? "integration.medstop.ordering_on" : "integration.medstop.ordering_off",
        entity: "medstop_credentials",
        meta: { was: before?.ordersEnabled ?? false, contactChanged: before?.orderContactEmail !== ordering.email || before?.orderContactPhone !== ordering.phone },
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/medstop/sync-now",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const orgId = req.auth!.orgId!;
      jobResponse(res, await dispatchJob(getSupabaseAdmin(env), env, "medstop_sync", { orgId, payload: { orgId }, requestedBy: req.auth!.userId }));
    }),
  );
}

function refusalText(kind: string, message: string): string {
  switch (kind) {
    case "auth":
      return "Med-Stop did not accept this key. Check that it was copied whole, that it has not expired, and that this server's address is on the key's IP filter.";
    case "ip_refused":
      return "Med-Stop's firewall refused this server's address. Add the API service's addresses to the key's IP filter in Med-Stop API Admin.";
    case "forbidden":
      return "Med-Stop accepted the key, but its security groups cannot read the random pools. Tick Random Selection on the key in Med-Stop API Admin.";
    default:
      return `Med-Stop did not answer (${message}). Nothing was stored — try again shortly.`;
  }
}

async function toggle(req: Request, res: Response, enabled: boolean): Promise<void> {
  const admin = getSupabaseAdmin(getAppLocals(req).env);
  const orgId = req.auth!.orgId!;
  const result = await setEnabled(admin, orgId, enabled);
  if ("error" in result) {
    res.status(502).json(apiError("db_error", result.error));
    return;
  }
  await writeAudit(admin, {
    orgId,
    actorId: req.auth!.userId,
    action: enabled ? "integration.medstop.enabled" : "integration.medstop.disabled",
    entity: "medstop_credentials",
  });
  res.json({ ok: true, enabled });
}
