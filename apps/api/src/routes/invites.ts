import { Router } from "express";
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inviteCreateSchema, isEmailDomainAllowed, renderInviteEmail, type InviteCreateRequest } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { validateBody, apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";
import { makeSender, sendEmail } from "../lib/mailer.js";
import type { Env } from "../env.js";

const INVITE_COLS = "id, org_id, email, role, status, expires_at, created_at";

/** Constant-time equality for the invite token (avoids timing leaks). */
function tokenMatches(provided: string | undefined, stored: string | null): boolean {
  if (!provided || !stored) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface InviteDelivery {
  sent: boolean;
  /** The action link — always returned when generated, so an admin can copy/share it even if email fails. */
  link: string | null;
  /** Why email wasn't sent: mail_disabled | send_failed | link_failed. null when sent. */
  reason: string | null;
}

/**
 * Deliver an invite through OUR mailer (Resend) instead of Supabase's built-in email. We ask Supabase
 * to GENERATE the action link (which also creates the auth user) without sending, then send a branded
 * email ourselves — reliable for external addresses and not subject to Supabase's default-email limits.
 * Falls back to a recovery link when the user already exists. The link is ALWAYS returned so invites work
 * even when email delivery is misconfigured (the admin can copy + share it directly).
 */
// Driver invites deep-link straight into the driver app: the emailed link stays https (Supabase's
// verify endpoint — email clients keep it), and only the final redirect hop targets the app scheme
// (registered in apps/driver/app.config.ts; must be allow-listed in Supabase auth Redirect URLs — D11).
const DRIVER_APP_ACCEPT_LINK = "fuelguard://accept-invite";

async function deliverInvite(admin: SupabaseClient, env: Env, orgName: string, email: string, token?: string | null, toDriverApp = false): Promise<InviteDelivery> {
  const base = toDriverApp ? DRIVER_APP_ACCEPT_LINK : `${env.WEB_APP_URL}/accept-invite`;
  const redirectTo = token ? `${base}?token=${encodeURIComponent(token)}` : base;
  let link: string | null = null;
  const invite = await admin.auth.admin.generateLink({ type: "invite", email, options: { redirectTo } });
  if (!invite.error && invite.data?.properties?.action_link) {
    link = invite.data.properties.action_link;
  } else {
    const recovery = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
    if (!recovery.error && recovery.data?.properties?.action_link) link = recovery.data.properties.action_link;
    else console.error(`[invites] generateLink failed for ${email}: ${invite.error?.message ?? ""} ${recovery.error?.message ?? ""}`);
  }
  if (!link) return { sent: false, link: null, reason: "link_failed" };
  if (env.MAIL_PROVIDER === "none") return { sent: false, link, reason: "mail_disabled" };

  const mail = renderInviteEmail(orgName, link);
  const sent = await makeSender(env)({ to: [email], subject: mail.subject, html: mail.html, text: mail.text });
  return { sent, link, reason: sent ? null : "send_failed" };
}

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
        subject: "FuelGuard test email",
        html: "<p>This is a FuelGuard test email. If you received it, outbound email is working.</p>",
        text: "This is a FuelGuard test email. If you received it, outbound email is working.",
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
      const { email, role, driver_id } = res.locals.body as InviteCreateRequest;
      const orgId = req.auth!.orgId!;

      const { data: org } = await admin
        .from("organizations")
        .select("name, allowed_domains")
        .eq("id", orgId)
        .single();
      if (!org) {
        res.status(404).json(apiError("org_not_found", "Organization not found"));
        return;
      }

      if (role === "driver") {
        // Driver invites accept personal emails (D1) but MUST reference an existing, unlinked roster
        // driver in this org (migration 0083). The domain allowlist does not apply to drivers.
        if (!driver_id) {
          res.status(422).json(apiError("driver_required", "A driver_id is required for driver invites"));
          return;
        }
        const { data: drv } = await admin
          .from("drivers")
          .select("id, user_id")
          .eq("id", driver_id)
          .eq("org_id", orgId)
          .maybeSingle();
        if (!drv) {
          res.status(422).json(apiError("driver_not_found", "No such driver in this organization"));
          return;
        }
        if (drv.user_id) {
          res.status(409).json(apiError("driver_already_linked", "That driver already has a login"));
          return;
        }
      } else if (!isEmailDomainAllowed(email, (org.allowed_domains ?? []) as string[])) {
        res.status(422).json(apiError("domain_not_allowed", "Email domain is not allowed for this organization"));
        return;
      }

      const token = `${randomUUID()}${randomUUID()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);
      const { data: invite, error } = await admin
        .from("invites")
        .insert({ org_id: orgId, email, role, driver_id: driver_id ?? null, invited_by: req.auth!.userId, token, expires_at: expiresAt.toISOString() })
        .select(INVITE_COLS)
        .single();
      if (error || !invite) {
        res.status(409).json(apiError("invite_exists", "An invite for this email already exists"));
        return;
      }

      // Deliver via our Resend mailer. Driver invites carry the token in the link so acceptance can
      // verify inbox possession (D15); office invites keep the domain-based check.
      const delivery = await deliverInvite(admin, env, (org.name as string) ?? "FuelGuard", email, role === "driver" ? token : null, role === "driver");
      if (!delivery.sent) console.error(`[invites] email not sent for ${email} (${delivery.reason})`);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "invite.created",
        entity: "invites",
        entityId: invite.id,
        meta: { email, role, emailSent: delivery.sent, reason: delivery.reason },
      });
      res.status(201).json({ invite, emailSent: delivery.sent, reason: delivery.reason });
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
        .select("id, email, status, role")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!existing) {
        res.status(404).json(apiError("not_found", "Invite not found"));
        return;
      }
      if (!["pending", "revoked", "expired"].includes(existing.status)) {
        res.status(409).json(apiError("invalid_status", "Only pending, revoked, or expired invites can be resent"));
        return;
      }

      const token = `${randomUUID()}${randomUUID()}`;
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { error } = await admin
        .from("invites")
        .update({ status: "pending", token, expires_at: expiresAt.toISOString(), invited_by: req.auth!.userId })
        .eq("id", id)
        .eq("org_id", orgId);

      if (error) {
        res.status(500).json(apiError("db_error", "Could not resend invite"));
        return;
      }

      // Deliver via our Resend mailer (invite link, or recovery link if the user already exists).
      const { data: org } = await admin.from("organizations").select("name").eq("id", orgId).maybeSingle();
      const delivery = await deliverInvite(
        admin,
        env,
        (org?.name as string) ?? "FuelGuard",
        existing.email,
        existing.role === "driver" ? token : null,
        existing.role === "driver",
      );
      const emailSent = delivery.sent;
      if (!emailSent) console.error(`[invites] resend not sent for ${existing.email} (${delivery.reason})`);

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "invite.resent",
        entity: "invites",
        entityId: id,
        meta: { email: existing.email, emailSent },
      });

      res.json({ ok: true, emailSent, reason: delivery.reason });
    }),
  );

  // Accept an invite → create the membership (audit B2). Authenticated invited user only.
  // Authorized by the JWT email matching a pending invite in an allowed domain (audit M2).
  router.post(
    "/accept",
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const email = req.auth!.email;
      if (!email) {
        res.status(400).json(apiError("no_email", "Authenticated user has no email"));
        return;
      }
      const body = (req.body ?? {}) as { token?: unknown };
      const token = typeof body.token === "string" ? body.token : undefined;

      const now = new Date().toISOString();
      const { data: invite } = await admin
        .from("invites")
        .select("id, org_id, role, status, token, driver_id")
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

      if (invite.role === "driver") {
        // D15: a driver must present the emailed token (proves inbox possession) — closes the
        // domain-relaxation takeover vector (audit §21 SB6). Office roles keep the domain check.
        if (!tokenMatches(token, invite.token as string | null)) {
          res.status(403).json(apiError("invalid_token", "Invalid or missing invitation token"));
          return;
        }
      } else {
        const { data: org } = await admin
          .from("organizations")
          .select("allowed_domains")
          .eq("id", invite.org_id)
          .single();
        if (!org || !isEmailDomainAllowed(email, org.allowed_domains as string[])) {
          res.status(422).json(apiError("domain_not_allowed", "Email domain not allowed"));
          return;
        }
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

      // Link the roster driver to this login (idempotent; never clobber an existing link) — 0083/D3.
      if (invite.driver_id) {
        await admin
          .from("drivers")
          .update({ user_id: req.auth!.userId })
          .eq("id", invite.driver_id)
          .eq("org_id", invite.org_id)
          .is("user_id", null);
      }

      await admin.from("invites").update({ status: "accepted" }).eq("id", invite.id);
      await writeAudit(admin, {
        orgId: invite.org_id,
        actorId: req.auth!.userId,
        action: "invite.accepted",
        entity: "memberships",
        meta: { email, role: invite.role, linkedDriver: invite.driver_id ?? null },
      });
      // The client must call supabase.auth.refreshSession() after this to pick up the new claims.
      res.json({ ok: true, orgId: invite.org_id, role: invite.role });
    }),
  );

  return router;
}
