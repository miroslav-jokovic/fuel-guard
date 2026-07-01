import { Router } from "express";
import { requireAuth, requireRole, requireOrg } from "../middleware/auth.js";
import { apiError, asyncHandler } from "../lib/http.js";
import { getSupabaseAdmin } from "../lib/supabaseAdmin.js";
import { getAppLocals } from "../lib/appLocals.js";
import { writeAudit } from "../lib/audit.js";

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

  return router;
}
