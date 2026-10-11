import type { Router } from "express";
import { fleetpalApiKeySchema, type FleetpalConnectionStatus } from "@silvicom/shared";
import { requireOrg, requireAdminOnly } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { dispatchJob, jobResponse } from "../../../queue/dispatch.js";
import { getCredential, setApiKey, setEnabled } from "../credentials.js";
import { listSyncState } from "../syncState.js";
import { probeApiKey } from "../probe.js";

/**
 * The FleetPal connection door (FLEETPAL-INTEGRATION-PLAN.md §8, 2026-10-04).
 *
 * ── WHY THIS EXISTS THIRTEEN DAYS AFTER THE COLLECTOR ──────────────────────────────────────────
 * F8 merged a scheduler that sweeps every org whose credential is switched on and holds a sealed
 * key, and the plan's go-live step said "store the key per org through `setApiKey`". Nothing called
 * `setApiKey`. The key is sealed under the production `SECRETS_ENCRYPTION_KEY`, which exists only
 * inside the api service, so the only ways to store one were this route or copying that key onto a
 * laptop — the second being exactly the posture `credentials.ts`'s header is written against. Every
 * `fleetpal_*` table was still empty on 2026-10-04.
 *
 * Shape follows the EFS SOAP door (`efs/routes/integrationSoap.ts`): admin-only by name
 * (`fleetpal.connection`), audited, never echoing key material. Storing a key takes a fresh sign-in,
 * as storing the EFS password does; switching the sweep OFF does not, because a kill switch that
 * asks for a password first is one an admin cannot pull in a hurry.
 *
 * Mounted on the shared `/api/integrations` router beside Samsara, McLeod and EFS.
 */
export function registerFleetpalIntegrationRoutes(router: Router): void {
  const adminOnly = [requireOrg, requireAdminOnly("fleetpal.connection")] as const;

  router.get(
    "/fleetpal/config",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const [credential, state] = await Promise.all([getCredential(admin, orgId), listSyncState(admin, orgId)]);
      const body: FleetpalConnectionStatus = {
        hasKey: credential?.hasKey ?? false,
        enabled: credential?.enabled ?? false,
        schedulerOn: env.FLEETPAL_SYNC_ENABLED === true,
        syncHours: env.FLEETPAL_SYNC_HOURS,
        lastSyncedAt: credential?.lastSyncedAt ?? null,
        lastError: credential?.lastError ?? null,
        resources: state.map((s) => ({
          resource: s.resource,
          lastRunAt: s.lastRunAt,
          lastError: s.lastError,
          rowsSeen: s.rowsSeen,
        })),
      };
      res.json(body);
    }),
  );

  /**
   * Store a key — only after FleetPal has accepted it.
   *
   * ⚠ Probe FIRST, seal second. A refused key is never written: the vendor shows a key once, so the
   * admin is still holding it right now and can paste it again; an hour from now, behind a red sweep,
   * nobody can tell a typo from a revoked key from an outage. A vendor that does not answer is not a
   * verdict on the key either, so that is refused too (502) rather than stored on hope.
   */
  router.post(
    "/fleetpal/key",
    ...adminOnly,
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const parsed = fleetpalApiKeySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json(apiError("bad_request", "Paste the FleetPal API key as { apiKey }."));
        return;
      }
      const baseUrl = (await getCredential(admin, orgId))?.baseUrl ?? env.FLEETPAL_BASE_URL;
      const probe = await probeApiKey(parsed.data.apiKey, baseUrl);
      if (!probe.ok) {
        const refused = probe.kind === "auth" || probe.kind === "forbidden";
        res.status(refused ? 400 : 502).json(
          apiError(
            refused ? "fleetpal_key_refused" : "fleetpal_unreachable",
            probe.kind === "auth"
              ? "FleetPal did not accept this key. Check that it was copied whole, and that it has not been revoked."
              : probe.kind === "forbidden"
                ? "FleetPal accepted the key, but its user's role cannot read the shop list. Issue the key from a user with read access to work orders and purchasing."
                : `FleetPal did not answer (${probe.message}). Nothing was stored — try again shortly.`,
          ),
        );
        return;
      }
      const stored = await setApiKey(admin, env, orgId, parsed.data.apiKey);
      if ("error" in stored) {
        res.status(422).json(apiError("fleetpal_key_not_stored", stored.error));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "integration.fleetpal.key_set",
        entity: "fleetpal_credentials",
        meta: { sealed: true, probeMs: probe.ms }, // never the key
      });
      res.json({ ok: true, probeMs: probe.ms });
    }),
  );

  // Switch this org's sweep on. Step-up, because turning it on is what makes the sealed key speak to
  // the vendor on a timer — the same act, in effect, as storing it.
  router.post(
    "/fleetpal/enable",
    ...adminOnly,
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      await toggle(req, res, true);
    }),
  );

  router.post(
    "/fleetpal/disable",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      await toggle(req, res, false);
    }),
  );

  /**
   * One sweep now, rather than at the next scheduler tick — the scheduler waits six minutes after a
   * boot and then an hour between passes. Same job kind the scheduler dispatches, so the ledger's
   * per-org overlap refusal covers a click and a tick alike (409 `job_running`), and the handler's
   * own `getApiKey` check means a click on a switched-off org does nothing but say so.
   */
  router.post(
    "/fleetpal/sync-now",
    ...adminOnly,
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const result = await dispatchJob(admin, env, "fleetpal_sync", {
        orgId,
        payload: { orgId },
        requestedBy: req.auth!.userId,
      });
      jobResponse(res, result);
    }),
  );
}

async function toggle(
  req: import("express").Request,
  res: import("express").Response,
  enabled: boolean,
): Promise<void> {
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
    action: enabled ? "integration.fleetpal.enabled" : "integration.fleetpal.disabled",
    entity: "fleetpal_credentials",
  });
  res.json({ ok: true, enabled });
}
