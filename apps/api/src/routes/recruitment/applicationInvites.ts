import { Router } from "express";
import {
  INVITE_TTL_DAYS_DEFAULT,
  applicationInviteCreateSchema,
  rolesThatCanView,
  rolesThatManage,
  type ApplicationInviteCreate,
} from "@fuelguard/shared";
import { requireAuth, requireOrg, requireRole } from "../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../lib/http.js";
import { getSupabaseAdmin } from "../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../lib/appLocals.js";
import { writeAudit } from "../../lib/audit.js";
import { mintInvitationToken } from "../../services/applicationIntake.js";

/**
 * Inviting an applicant to fill in their own §391.21 application (H5).
 *
 * ── THE LINK IS RETURNED ONCE AND NEVER AGAIN ──────────────────────────────────────────────────
 * The response carries the only copy of the token that will ever exist outside the applicant's
 * inbox; the table holds a SHA-256. That is the same contract `/api/invites` offers — "the link is
 * always returned when it could be generated, even if the email failed to send" — with one addition
 * it does not have: there is no resend that re-reads the old token, because there is nothing to
 * re-read. A lost link is replaced by a NEW invitation, and the old one is revoked.
 *
 * ── WHY A RECRUITER MAY DO THIS AND MAY NOT HIRE ───────────────────────────────────────────────
 * Sending somebody a form is the recruitment act; flipping `drivers.status` is not (0213). So this
 * takes the section's own manage guard, unlike `/hire` next door.
 */
export function recruitmentApplicationInvitesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  const canView = requireRole(...rolesThatCanView("recruitment"));
  const canInvite = requireRole(...rolesThatManage("recruitment"));

  const INVITE_COLS = "id, driver_id, email, expires_at, used_at, revoked_at, created_at";

  router.get(
    "/drivers/:driverId/application-invites",
    requireOrg,
    canView,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("application_invitations")
        // Never `token_hash`: a hash is not a link, but it is also not something a UI has any use
        // for, and a column that leaves the database is a column somebody eventually logs.
        .select(INVITE_COLS)
        .eq("org_id", req.auth!.orgId!)
        .eq("driver_id", String(req.params.driverId ?? ""))
        .order("created_at", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not load the invitations"));
        return;
      }
      res.json({ invitations: data ?? [] });
    }),
  );

  router.post(
    "/application-invites",
    requireOrg,
    canInvite,
    validateBody(applicationInviteCreateSchema),
    asyncHandler(async (req, res) => {
      const { env } = getAppLocals(req);
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const body = res.locals.body as ApplicationInviteCreate;

      const { data: driver } = await admin
        .from("drivers")
        .select("id, status")
        .eq("id", body.driver_id)
        .eq("org_id", orgId)
        .maybeSingle();
      const row = driver as { id: string; status: string } | null;
      if (!row) {
        res.status(404).json(apiError("not_found", "Driver not found"));
        return;
      }
      // An application is what somebody submits BEFORE they are hired. Sending the form to a driver
      // who already works here would collect a §391.21 certification dated after their hire, which
      // is not the document §391.51(b)(1) is asking for.
      if (row.status !== "applicant") {
        res.status(409).json(apiError("not_an_applicant", `This driver is ${row.status}, not an applicant.`));
        return;
      }

      const { token, hash } = mintInvitationToken();
      const days = body.expires_in_days ?? INVITE_TTL_DAYS_DEFAULT;
      const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();

      const { data, error } = await admin
        .from("application_invitations")
        .insert({
          org_id: orgId,
          driver_id: body.driver_id,
          token_hash: hash,
          email: body.email ?? null,
          expires_at: expiresAt,
          created_by: req.auth!.userId,
        })
        .select(INVITE_COLS)
        .single();
      if (error || !data) {
        res.status(500).json(apiError("db_error", "Could not create the invitation"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.application_invited",
        entity: "application_invitations",
        entityId: (data as { id: string }).id,
        // The id and the expiry. NEVER the token or its hash — an audit log is the last place a
        // credential should be recoverable from, and the hash is a credential's fingerprint.
        meta: { driverId: body.driver_id, expiresAt, email: body.email ?? null },
      });

      res.status(201).json({
        invitation: data,
        // The only copy. Not stored, not re-derivable, not returned again.
        link: `${env.WEB_APP_URL}/apply/${token}`,
      });
    }),
  );

  /** Revocation is an edit here rather than a new row: an invitation is a credential, not evidence,
   *  and the auditable fact is the `driver_authorizations` signature it leads to. */
  router.post(
    "/application-invites/:id/revoke",
    requireOrg,
    canInvite,
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const { data, error } = await admin
        .from("application_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", String(req.params.id ?? ""))
        .eq("org_id", orgId)
        .is("used_at", null)
        .select(INVITE_COLS)
        .maybeSingle();
      if (error) {
        res.status(500).json(apiError("db_error", "Could not revoke the invitation"));
        return;
      }
      if (!data) {
        res.status(404).json(apiError("not_found", "That invitation is not open."));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "compliance.application_invite_revoked",
        entity: "application_invitations",
        entityId: (data as { id: string }).id,
        meta: { driverId: (data as { driver_id: string }).driver_id },
      });
      res.json({ invitation: data });
    }),
  );

  return router;
}
