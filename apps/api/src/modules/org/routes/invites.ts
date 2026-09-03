import { Router } from "express";
import { randomUUID } from "node:crypto";
import {
  inviteAcceptSchema,
  inviteCreateSchema,
  isEmailDomainAllowed,
  type InviteAcceptRequest,
  type InviteCreateRequest,
} from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { validateBody, apiError, asyncHandler } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { deliverInvite } from "../inviteDelivery.js";
import { writeAudit } from "../../../lib/audit.js";
import { sendEmail } from "../../../lib/mailer.js";

const INVITE_COLS = "id, org_id, email, role, status, expires_at, created_at, full_name";

export function invitesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // Send a test email to the caller's own address and report the provider's exact response (admin).
  router.post(
    "/mail-test",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const to = req.auth!.email;
      if (!to) {
        res.status(400).json(apiError("no_email", "Your account has no email address"));
        return;
      }
      const result = await sendEmail(env, {
        to: [to],
        subject: "Silvicom 360 test email",
        html: "<p>This is a Silvicom 360 test email. If you received it, outbound email is working.</p>",
        text: "This is a Silvicom 360 test email. If you received it, outbound email is working.",
      });
      res.json({ ...result, from: env.MAIL_FROM, to });
    }),
  );

  // List invites for the caller's org (admin).
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { data, error } = await admin
        .from("invites")
        .select(INVITE_COLS)
        .eq("org_id", req.auth!.orgId!)
        .order("created_at", { ascending: false });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not list invites"));
        return;
      }
      res.json({ invites: data });
    }),
  );

  // Create an invite (admin). Domain-checked (audit M2), then sends the Supabase invite email.
  router.post(
    "/",
    requireOrg,
    requireRole("admin"),
    validateBody(inviteCreateSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const { email, role, fullName } = res.locals.body as InviteCreateRequest;
      const orgId = req.auth!.orgId!;

      const { data: org } = await admin
        .from("organizations")
        .select("name, allowed_domains")
        .eq("id", orgId)
        .single();
      if (!org || !isEmailDomainAllowed(email, (org.allowed_domains ?? []) as string[])) {
        res
          .status(422)
          .json(
            apiError("domain_not_allowed", "Email domain is not allowed for this organization"),
          );
        return;
      }

      const token = `${randomUUID()}${randomUUID()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const { data: invite, error } = await admin
        .from("invites")
        .insert({
          org_id: orgId,
          email,
          role,
          full_name: fullName ?? null,
          invited_by: req.auth!.userId,
          token,
          expires_at: expiresAt.toISOString(),
        })
        .select(INVITE_COLS)
        .single();
      if (error || !invite) {
        res.status(409).json(apiError("invite_exists", "An invite for this email already exists"));
        return;
      }

      // Deliver via our Resend mailer (branded, reliable for external addresses). The link is returned
      // regardless so the admin can copy/share it if email delivery is misconfigured.
      const delivery = await deliverInvite(admin, env, (org.name as string) ?? "Silvicom 360", email);
      if (!delivery.sent)
        console.error(`[invites] email not sent for ${email} (${delivery.reason})`);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "invite.created",
        entity: "invites",
        entityId: invite.id,
        meta: { email, role, fullName: fullName ?? null, emailSent: delivery.sent, reason: delivery.reason },
      });
      // `link` is returned to the ADMIN who created the invite, deliberately. The comment on
      // InviteDelivery.link has promised this since the mailer was written and the response never
      // carried it, so "email didn't arrive" had no recovery path but a resend into the same void.
      // Admin-only (requireRole above) and org-scoped, and the token is the same one already in the
      // recipient's inbox — this exposes nothing the invite did not already put on the wire.
      res.status(201).json({ invite, emailSent: delivery.sent, reason: delivery.reason, link: delivery.link });
    }),
  );

  // Revoke a pending invite (admin).
  router.post(
    "/:id/revoke",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");
      const { error } = await admin
        .from("invites")
        .update({ status: "revoked" })
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not revoke invite"));
        return;
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "invite.revoked",
        entity: "invites",
        entityId: id,
      });
      res.json({ ok: true });
    }),
  );

  /**
   * Delete an invite that is no longer wanted (admin).
   *
   * Revoking hides an invite from use; it does not clear it off the page, and until 2026-09-02
   * nothing did — the Users page accumulated revoked rows an admin could neither act on nor remove.
   *
   * ── WHY DELETION IS ALLOWED HERE AND REFUSED ON `drivers` ──────────────────────────────────────
   * `invites` is NOT an evidence table. It is not in `RETENTION_FORBIDDEN`, no regulation reads it,
   * and it holds no §391.51 record — it is the record of an offer, and the record that MATTERS is
   * the audit row, which survives this and names the email, the role and who removed it. Compare
   * `drivers` (0235), where a hard delete raises DR010 for everybody including the service role
   * because §390.32(d) wants the file reproducible.
   *
   * ⚠ ONLY a revoked or expired invite. A PENDING one must be revoked first, deliberately: revoking
   * is what makes the outstanding link unusable, and deleting the row without it would leave a live
   * invitation in somebody's inbox and nothing on screen to say so. Two steps, because they are two
   * different acts.
   *
   * An ACCEPTED invite is likewise refused — it is the provenance of a membership that exists.
   */
  router.delete(
    "/:id",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");

      const { data: existing } = await admin
        .from("invites")
        .select("id, email, role, status")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!existing) {
        res.status(404).json(apiError("not_found", "Invite not found"));
        return;
      }
      if (!["revoked", "expired"].includes(existing.status)) {
        res
          .status(409)
          .json(
            apiError(
              "invalid_status",
              existing.status === "accepted"
                ? "This invitation was accepted and is the record of an existing member"
                : "Revoke the invitation first — that is what makes the emailed link unusable",
            ),
          );
        return;
      }

      const { error } = await admin
        .from("invites")
        .delete()
        .eq("id", id)
        .eq("org_id", orgId);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not delete invite"));
        return;
      }

      // Written AFTER the delete and carrying the whole row: this audit entry is the only thing left
      // that says the invitation existed, so it has to hold what the row held.
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "invite.deleted",
        entity: "invites",
        entityId: id,
        meta: { email: existing.email, role: existing.role, status: existing.status },
      });
      res.json({ ok: true });
    }),
  );

  // Resend a revoked or expired invite (admin) — resets to pending with a fresh token.
  router.post(
    "/:id/resend",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const id = String(req.params.id ?? "");

      const { data: existing } = await admin
        .from("invites")
        .select("id, email, status")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!existing) {
        res.status(404).json(apiError("not_found", "Invite not found"));
        return;
      }
      if (!["pending", "revoked", "expired"].includes(existing.status)) {
        res
          .status(409)
          .json(
            apiError("invalid_status", "Only pending, revoked, or expired invites can be resent"),
          );
        return;
      }

      const token = `${randomUUID()}${randomUUID()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { error } = await admin
        .from("invites")
        .update({
          status: "pending",
          token,
          expires_at: expiresAt.toISOString(),
          invited_by: req.auth!.userId,
        })
        .eq("id", id)
        .eq("org_id", orgId);

      if (error) {
        res.status(500).json(apiError("db_error", "Could not resend invite"));
        return;
      }

      // Deliver via our Resend mailer (invite link, or recovery link if the user already exists).
      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", orgId)
        .maybeSingle();
      const delivery = await deliverInvite(
        admin,
        env,
        (org?.name as string) ?? "Silvicom 360",
        existing.email,
      );
      const emailSent = delivery.sent;
      if (!emailSent)
        console.error(`[invites] resend not sent for ${existing.email} (${delivery.reason})`);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "invite.resent",
        entity: "invites",
        entityId: id,
        meta: { email: existing.email, emailSent },
      });

      res.json({ ok: true, emailSent, reason: delivery.reason, link: delivery.link });
    }),
  );

  // Accept an invite → create the membership (audit B2). Authenticated invited user only.
  // Authorized by the JWT email matching a pending invite in an allowed domain (audit M2).
  router.post(
    "/accept",
    validateBody(inviteAcceptSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { fullName: typedName } = (res.locals.body ?? {}) as InviteAcceptRequest;
      const email = req.auth!.email;
      if (!email) {
        res.status(400).json(apiError("no_email", "Authenticated user has no email"));
        return;
      }

      // An UNVERIFIED email claim must not be able to consume an invite (audit 2026-08-09, finding
      // 3.5). Acceptance is authorized purely by "my token says I am this address" — the invite
      // token generated at creation is never presented — so if the project ever allows sign-up
      // without confirming the address, learning an invited address (or just an allowed domain)
      // would be enough to take a pending invite, including an admin one.
      //
      // Confirmation status is not in the access token, so read it from the auth record and trust
      // that over the claim. Wiring the invite token end-to-end is the stronger fix and is tracked
      // separately; this closes the hole without touching the email delivery flow.
      const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(req.auth!.userId);
      const confirmedAt = authUser?.user?.email_confirmed_at ?? null;
      const confirmedEmail = authUser?.user?.email?.toLowerCase() ?? null;
      if (authErr || !confirmedAt || confirmedEmail !== email.toLowerCase()) {
        res.status(403).json(apiError("email_unverified", "Confirm your email address before accepting an invitation"));
        return;
      }

      const now = new Date().toISOString();
      const { data: invite } = await admin
        .from("invites")
        .select("id, org_id, role, status, driver_id, full_name")
        .eq("email", email)
        .eq("status", "pending")
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!invite) {
        res.status(404).json(apiError("no_invite", "No pending invitation for this account"));
        return;
      }

      const { data: org } = await admin
        .from("organizations")
        .select("allowed_domains")
        .eq("id", invite.org_id)
        .single();
      if (!org || !isEmailDomainAllowed(email, org.allowed_domains as string[])) {
        res.status(422).json(apiError("domain_not_allowed", "Email domain not allowed"));
        return;
      }

      const { error: mErr } = await admin
        .from("memberships")
        .upsert(
          { org_id: invite.org_id, user_id: req.auth!.userId, role: invite.role },
          { onConflict: "org_id,user_id" },
        );
      if (mErr) {
        res.status(500).json(apiError("db_error", "Could not create membership"));
        return;
      }

      // Bind login → roster driver (0102 / plan §3.2). THIS is what makes the driver app work: without
      // it `drivers.user_id` stays null, `auth_driver_id()` (0083) returns null, and GET /api/me/driver
      // 404s `no_driver_record`. Runs BEFORE the invite is marked accepted so a failure here leaves the
      // invite pending and retryable rather than burning it on a half-linked account.
      // A generic office invite has `driver_id` null and skips this entirely.
      if (invite.driver_id) {
        const { data: drv } = await admin
          .from("drivers")
          .select("id, user_id")
          .eq("id", invite.driver_id)
          .eq("org_id", invite.org_id)
          .maybeSingle();
        if (!drv) {
          res.status(404).json(apiError("no_driver_record", "Invited driver no longer exists"));
          return;
        }
        // Idempotent for the SAME user (a re-accept is harmless); a DIFFERENT user is a hijack attempt
        // or a mis-sent invite — either way, refuse rather than move the link.
        if (drv.user_id && drv.user_id !== req.auth!.userId) {
          res
            .status(409)
            .json(apiError("already_linked", "This driver is already linked to another account"));
          return;
        }
        const { error: linkErr } = await admin
          .from("drivers")
          .update({ user_id: req.auth!.userId, app_access_enabled: true })
          .eq("id", invite.driver_id)
          .eq("org_id", invite.org_id);
        if (linkErr) {
          res.status(500).json(apiError("db_error", "Could not link driver"));
          return;
        }
      }

      // The person's name (0301, D-MEM1): what they typed on the accept page, else what the admin typed
      // on the invitation, else nothing — a profile is never written with a name nobody said. Written
      // AFTER the membership so a failure here cannot leave a person named but not admitted, and as a
      // full-row upsert because the row is the whole answer, not a column of it.
      const name = typedName ?? (invite.full_name as string | null) ?? null;
      if (name) {
        const { error: nameErr } = await admin.from("user_profiles").upsert(
          { user_id: req.auth!.userId, full_name: name, updated_at: new Date().toISOString(), updated_by: req.auth!.userId },
          { onConflict: "user_id" },
        );
        if (nameErr) console.error(`[invites] profile not written for ${req.auth!.userId}: ${nameErr.message}`);
      }

      await admin.from("invites").update({ status: "accepted" }).eq("id", invite.id);
      await writeAudit(admin, {
        orgId: invite.org_id,
        actorId: req.auth!.userId,
        action: "invite.accepted",
        entity: "memberships",
        meta: { email, driverId: invite.driver_id ?? null },
      });
      // The web app must call supabase.auth.refreshSession() after this to pick up the new claims.
      res.json({ ok: true, orgId: invite.org_id, role: invite.role });
    }),
  );

  return router;
}
