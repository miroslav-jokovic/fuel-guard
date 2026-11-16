import { Router } from "express";
import { isRecordId } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { writeAudit } from "../../../lib/audit.js";
import { lookupMemberRole } from "../memberLookup.js";
import { endSessions } from "../accessWrites.js";

/**
 * `DELETE /api/members/:userId/second-factor` — an admin removes a colleague's authenticator
 * (INSTALLED-APP-PLAN IA-S1; Q-IA11 (a), the owner's ruling of 2026-11-15).
 *
 * For the phone that was lost, broken or replaced: without this, a person who cannot produce a code is
 * locked out for good — Supabase has no recovery codes. After it they sign in with their password and, if
 * they are required to (an admin past the company's date), set a new authenticator up before the app opens.
 *
 *  · Through Supabase's own admin API (`auth.admin.mfa`), never by deleting rows: its bookkeeping of
 *    challenges and session levels stays its own.
 *  · EVERY factor of the person, a half-finished enrolment included — one left behind would refuse the new one.
 *  · It signs them out everywhere. A lost phone may also be a signed-in phone, and a session that took its
 *    second step with a factor that no longer exists should not go on saying so.
 *  · The admin's password again (`requireFreshAuth`), as every write on the Users page: this is the act that
 *    takes a protection OFF somebody's account, so a stolen admin session must not be able to do it.
 *  · Not yourself: an admin who still has their phone turns it off on the Two-step sign-in page where they
 *    may, and one who has lost it cannot be confirmed by a session that may be the thief's. Another admin of
 *    the company does it, or Silvicom from the platform console (Q-IA11 (b)).
 *  · Audited as `member.second_factor_removed`, with how many factors there were — never anything of one.
 */
export function memberSecondFactorRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.delete(
    "/:userId/second-factor",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const orgId = req.auth!.orgId!;
      const userId = String(req.params.userId ?? "");

      if (userId === req.auth!.userId) {
        res.status(400).json(apiError("cannot_remove_own", "Another admin has to remove your two-step sign-in. If you still have your authenticator app, turn it off under Two-step sign-in in the account menu."));
        return;
      }
      // Org-scoped: the person must be a member of the CALLER's company, whatever else they belong to.
      const member = isRecordId(userId) ? await lookupMemberRole(admin, orgId, userId) : ({ ok: false, reason: "not_found" } as const);
      if (!member.ok) {
        if (member.reason === "not_found") res.status(404).json(apiError("not_found", "Member not found"));
        else res.status(500).json(apiError("db_error", "Could not load member"));
        return;
      }

      const listed = await admin.auth.admin.mfa.listFactors({ userId });
      if (listed.error) throw new Error(listed.error.message);
      const factors = listed.data?.factors ?? [];
      if (factors.length === 0) {
        res.status(404).json(apiError("no_second_factor", "This member has no two-step sign-in set up."));
        return;
      }
      for (const factor of factors) {
        const removed = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
        if (removed.error) throw new Error(removed.error.message);
      }
      await writeAudit(admin, {
        orgId,
        actorId: req.auth!.userId,
        action: "member.second_factor_removed",
        entity: "member",
        entityId: userId,
        meta: { factors: factors.length, verified: factors.filter((f) => f.status === "verified").length },
      });
      await endSessions(admin, userId, "member.second_factor_removed");
      res.json({ removed: true });
    }),
  );

  return router;
}
