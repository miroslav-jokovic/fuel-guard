import { Router } from "express";
import { z } from "zod";
import { roleSchema } from "@fuelguard/shared";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler, validateBody } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";

const roleUpdateSchema = z.object({ role: roleSchema });

export function membersRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  // List active members for the caller's org (admin).
  router.get(
    "/",
    requireOrg,
    requireRole("admin"),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;

      const { data: memberships, error } = await admin
        .from("memberships")
        .select("user_id, role, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true });

      if (error) {
        res.status(500).json(apiError("db_error", "Could not list members"));
        return;
      }

      const members = await Promise.all(
        (memberships ?? []).map(async (m) => {
          const { data } = await admin.auth.admin.getUserById(m.user_id);
          return {
            userId: m.user_id as string,
            email: data?.user?.email ?? null,
            role: m.role as string,
            joinedAt: m.created_at as string,
          };
        }),
      );

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

  // Change a member's role (admin). Guards against demoting the org's LAST admin, which would lock everyone
  // out of member/settings management. The affected user's permissions update on their next token refresh.
  router.patch(
    "/:userId",
    requireOrg,
    requireRole("admin"),
    validateBody(roleUpdateSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");
      const newRole = (req.body as { role: string }).role;

      const { data: current, error: curErr } = await admin
        .from("memberships")
        .select("role")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (curErr) {
        res.status(500).json(apiError("db_error", "Could not load member"));
        return;
      }
      if (!current) {
        res.status(404).json(apiError("not_found", "Member not found"));
        return;
      }
      if (current.role === newRole) {
        res.json({ ok: true });
        return;
      }

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

      res.json({ ok: true });
    }),
  );

  return router;
}
