import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";

/**
 * Declaring — and withdrawing — the carrier's TMS as the master of the roster.
 *
 * This is the single most consequential switch in the McLeod integration. Setting it demotes three
 * Samsara syncs to link-only (D-MR5, D-MR12) and unlocks the ingest's identity, create and retire
 * modes (D-MR13). It has lived in `org_integrations.config.roster_master` since M5 with NO WAY TO SET
 * IT: `/mcleod/config`, `/mcleod/enable` and `/mcleod/disable` do not touch it, so the only path was
 * a hand-written UPDATE in the SQL editor. A change that reassigns ownership of who is employed and
 * what is in the fleet should be an attributable act by a named admin, not a DBA's afternoon.
 *
 * It lives in its own router rather than in `routes/integrations.ts` because that file is pinned at
 * 831 lines by `lint:filesize` and sits at 830. Mounted on the same `/api/integrations` base, so the
 * path reads as part of the same family.
 *
 * ── THE ONE REFUSAL THAT MATTERS ────────────────────────────────────────────────────────────────
 * Turning this ON while the integration is disabled or has no ingest token would be the worst
 * available outcome: the Samsara syncs stop maintaining the roster, and nothing takes over, because
 * no agent can authenticate. The roster would simply stop being updated and nothing would raise —
 * exactly the silent-failure shape §3 of the plan is written against. So mastery may only be
 * declared for an integration that is enabled and holds a token.
 *
 * Turning it OFF is never refused. It is the rollback, and a rollback that can be blocked is not one.
 */

const bodySchema = z.object({ enabled: z.boolean() });

interface IntegrationRow {
  enabled: boolean | null;
  ingest_token_hash: string | null;
  config: Record<string, unknown> | null;
}

export function tmsRosterMasterRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/mcleod/roster-master",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json(apiError("invalid_request", "Send { enabled: true } or { enabled: false }."));
        return;
      }
      const { enabled } = parsed.data;
      const orgId = req.auth!.orgId!;
      const admin = getSupabaseAdmin(getAppLocals(req).env);

      const { data, error } = await admin
        .from("org_integrations")
        .select("enabled, ingest_token_hash, config")
        .eq("org_id", orgId)
        .eq("provider", "mcleod")
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as IntegrationRow | null;

      if (!row) {
        res
          .status(409)
          .json(apiError("mcleod_not_configured", "Connect the McLeod integration before declaring it the roster master."));
        return;
      }
      if (enabled && (row.enabled !== true || !row.ingest_token_hash)) {
        res
          .status(409)
          .json(
            apiError(
              "mcleod_not_connected",
              "McLeod must be enabled with a live ingest token before it can master the roster — otherwise the Samsara syncs stand down and nothing replaces them.",
            ),
          );
        return;
      }

      // Read-modify-write on the jsonb rather than an upsert: `lint:upserts` forbids a partial upsert
      // (Postgres checks NOT NULL before conflict arbitration), and the row is guaranteed to exist by
      // the guard above. Spreading the stored config preserves `company_id` and the entity toggles
      // that M7 will add alongside this key.
      const config = { ...(row.config ?? {}), roster_master: enabled };
      const { error: upErr } = await admin
        .from("org_integrations")
        .update({ config })
        .eq("org_id", orgId)
        .eq("provider", "mcleod");
      if (upErr) throw new Error(upErr.message);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: enabled ? "integration.mcleod.roster_master_declared" : "integration.mcleod.roster_master_withdrawn",
        entity: "org_integrations",
        meta: { provider: "mcleod" },
      });

      res.json({ rosterMaster: enabled });
    }),
  );

  return router;
}
