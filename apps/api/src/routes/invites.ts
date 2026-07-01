import { Router } from "express";
import { randomUUID } from "node:crypto";
import { inviteCreateSchema, isEmailDomainAllowed, type InviteCreateRequest } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { validateBody, apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";

const INVITE_COLS = "id, org_id, email, role, status, expires_at, created_at";

export function invitesRouter(): Router {
  const router = Router();
  router.use(requireAuth);

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
      const { email, role } = res.locals.body as InviteCreateRequest;
      const orgId = req.auth!.orgId!;

      const { data: org } = await admin
        .from("organizations")
        .select("allowed_domains")
        .eq("id", orgId)
        .single();
      if (!org || !isEmailDomainAllowed(email, org.allowed_domains as string[])) {
        res.status(422).json(apiError("domain_not_allowed", "Email domain is not allowed for this organization"));
        return;
      }

      const token = `${randomUUID()}${randomUUID()}`;
      const { data: invite, error } = await admin
        .from("invites")
        .insert({ org_id: orgId, email, role, invited_by: req.auth!.userId, token })
        .select(INVITE_COLS)
        .single();
      if (error || !invite) {
        res.status(409).json(apiError("invite_exists", "An invite for this email already exists"));
        return;
      }

      // Send the Supabase invite email (handles sign-up + password). Non-fatal on failure.
      const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${env.WEB_APP_URL}/accept-invite`,
      });
      if (mailErr) {
        console.error(`[invites] email send failed for ${email}: ${mailErr.message}`);
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "invite.created",
        entity: "invites",
        entityId: invite.id,
        meta: { email, role },
      });
      res.status(201).json({ invite });
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

      const { data: invite } = await admin
        .from("invites")
        .select("id, org_id, role, status")
        .eq("email", email)
        .eq("status", "pending")
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

      await admin.from("invites").update({ status: "accepted" }).eq("id", invite.id);
      await writeAudit(admin, {
        orgId: invite.org_id,
        actorId: req.auth!.userId,
        action: "invite.accepted",
        entity: "memberships",
        meta: { email },
      });
      // The web app must call supabase.auth.refreshSession() after this to pick up the new claims.
      res.json({ ok: true, orgId: invite.org_id, role: invite.role });
    }),
  );

  return router;
}
