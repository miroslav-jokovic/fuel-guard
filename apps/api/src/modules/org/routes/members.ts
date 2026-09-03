import { Router } from "express";
import { memberUpdateSchema, type MemberUpdateRequest } from "@silvicom/shared";
import { requireAuth, requireRole, requireOrg } from "../../../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { writeAudit } from "../../../lib/audit.js";
import { revokePushTokens } from "../../messaging/index.js";
import { lookupMemberRole } from "../memberLookup.js";

/** One row of `org_member_directory()` (0301). */
interface DirectoryRow {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  joined_at: string;
}

export function membersRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  /**
   * List active members for the caller's org (admin).
   *
   * One round trip since 0301: `org_member_directory()` joins memberships, auth.users, the profile
   * and the roster server-side. Before it, this handler read the memberships and then called
   * `auth.admin.getUserById` once PER MEMBER for the email — five round trips for five members and
   * three hundred for three hundred — and had no name to show at all.
   */
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      const { data, error } = await admin.rpc("org_member_directory", { p_org_id: orgId });
      if (error) {
        res.status(500).json(apiError("db_error", "Could not list members"));
        return;
      }

      const members = ((data ?? []) as DirectoryRow[]).map((m) => ({
        userId: m.user_id,
        email: m.email,
        fullName: m.full_name,
        role: m.role,
        joinedAt: m.joined_at,
      }));
      res.json({ members });
    }),
  );

  // Remove a member from the org (admin). Deletes the membership only — does not delete the auth account.
  router.delete(
    "/:userId",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");

      if (userId === req.auth!.userId) {
        res.status(400).json(apiError("cannot_remove_self", "You cannot remove yourself from the organization"));
        return;
      }

      const { error } = await admin
        .from("memberships")
        .delete()
        .eq("org_id", orgId)
        .eq("user_id", userId);

      if (error) {
        res.status(500).json(apiError("db_error", "Could not remove member"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "member.removed",
        entity: "memberships",
        entityId: userId,
      });

      res.json({ ok: true });
    }),
  );

  // Revoke a driver's (or any member's) access (admin, offboarding — plan D14). Removes org access,
  // deactivates any linked driver record, and audits. NOTE: the user's existing ACCESS token stays
  // valid until it expires (jwt_expiry, D31 = 1h); membership deletion cuts access on the next refresh.
  // The auth account itself is kept (re-hire); use delete-account for full identity removal.
  router.post(
    "/:userId/revoke",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");

      if (userId === req.auth!.userId) {
        res.status(400).json(apiError("cannot_revoke_self", "You cannot revoke your own access"));
        return;
      }

      await admin.from("drivers").update({ status: "inactive" }).eq("org_id", orgId).eq("user_id", userId);
      // An offboarded driver's PERSONAL phone must stop receiving load and message content
      // immediately — no token expiry window closes that gap (D14/D53).
      await revokePushTokens(admin, userId);

      const { error } = await admin.from("memberships").delete().eq("org_id", orgId).eq("user_id", userId);
      if (error) {
        res.status(500).json(apiError("db_error", "Could not revoke access"));
        return;
      }

      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "member.access_revoked",
        entity: "memberships",
        entityId: userId,
      });

      res.json({ ok: true });
    }),
  );

  /**
   * Change a member's role and/or name (admin).
   *
   * The role half guards against demoting the org's LAST admin, which would lock everyone out of
   * member/settings management; the affected user's permissions update on their next token refresh.
   *
   * The name half (0301, D-MEM1/D-MEM2) writes the person's profile — keyed by user, not by
   * membership, so the one org-scoped question is asked FIRST: is this person a member of the
   * caller's org at all? `lookupMemberRole` is that question, and without it an admin of one tenant
   * could rename a user of another by guessing a uuid. A full-row upsert, because the profile is the
   * whole answer and a partial one is the 2026-08-10 incident. ⚠ Renaming a DRIVER member here writes
   * a profile that outranks the roster's name (D-MEM3) — the roster stays as the company's record and
   * is edited on the Drivers page.
   */
  router.patch(
    "/:userId",
    requireOrg,
    requireRole("admin"),
    validateBody(memberUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");
      const { role: newRole, fullName } = res.locals.body as MemberUpdateRequest;

      const current = await lookupMemberRole(admin, orgId, userId);
      if (!current.ok) {
        if (current.reason === "not_found") res.status(404).json(apiError("not_found", "Member not found"));
        else res.status(500).json(apiError("db_error", "Could not load member"));
        return;
      }

      if (newRole !== undefined && newRole !== current.role) {
        // Never leave the org without an admin.
        if (current.role === "admin" && newRole !== "admin") {
          const { count } = await admin
            .from("memberships")
            .select("user_id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .eq("role", "admin");
          if ((count ?? 0) <= 1) {
            res.status(400).json(apiError("last_admin", "This is the only admin — promote someone else to admin first."));
            return;
          }
        }

        const { error } = await admin
          .from("memberships")
          .update({ role: newRole })
          .eq("org_id", orgId)
          .eq("user_id", userId);
        if (error) {
          res.status(500).json(apiError("db_error", "Could not update role"));
          return;
        }

        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "member.role_changed",
          entity: "memberships",
          entityId: userId,
          meta: { from: current.role, to: newRole },
        });
      }

      if (fullName !== undefined) {
        const { error } = await admin.from("user_profiles").upsert(
          { user_id: userId, full_name: fullName, updated_at: new Date().toISOString(), updated_by: req.auth!.userId },
          { onConflict: "user_id" },
        );
        if (error) {
          res.status(500).json(apiError("db_error", "Could not update name"));
          return;
        }

        await writeAudit(admin, {
          orgId,
          actorId: req.auth!.userId,
          action: "member.renamed",
          entity: "user_profiles",
          entityId: userId,
          meta: { fullName },
        });
      }

      res.json({ ok: true });
    }),
  );

  return router;
}
