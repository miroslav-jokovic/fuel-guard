import { Router } from "express";
import { isRosterIssuedRole } from "@silvicom/shared";
import { requireAuth, requireOrg, requireRole } from "../../../middleware/auth.js";
import { requireFreshAuth } from "../../../middleware/requireFreshAuth.js";
import { apiError, asyncHandler } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { lookupMemberRole } from "../memberLookup.js";
import { isResetError, issueReset, resetTargetForEmail } from "../passwordReset.js";

/**
 * POST /api/members/:userId/password-reset — an admin emails a member a reset link.
 *
 * For "I never got the email" and "I'm locked out and can't reach the sign-in page's link", and it
 * sends the SAME link the person could have asked for (`issueReset`). What it deliberately does not
 * do is the whole design (D-PWR8, PASSWORD-RESET-PLAN.md):
 *
 *  · The admin never sees the link and never sets the password. The answer is `{ sent, expiresAt }`.
 *    A link in the admin's hands would be the admin choosing a colleague's password, and every action
 *    after that would be audited under the colleague's name. The invitation shows its link because
 *    there is no account yet to impersonate; here there is.
 *  · Mail must work. If it is off or the provider refuses, this is an error, and the link just minted
 *    is revoked — there is no "copy it yourself" fallback, for the reason above.
 *  · Step-up (`requireFreshAuth`). Sending a reset ends every one of the person's sessions once used,
 *    and a stolen admin session should not be able to aim that at a colleague without the password.
 *  · Not yourself (use "Forgot password?" — it is the same link without an admin in the audit row),
 *    and not a driver: their password is company-issued and reset on the Drivers page (DC3/DC10).
 */
export function memberPasswordResetRouter(): Router {
  const router = Router();
  router.use(requireAuth);

  router.post(
    "/:userId/password-reset",
    requireOrg,
    requireRole("admin"),
    requireFreshAuth(),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const orgId = req.auth!.orgId!;
      const actorId = req.auth!.userId;
      const userId = String(req.params.userId ?? "");

      if (userId === actorId) {
        res.status(400).json(apiError("cannot_reset_self", "Use “Forgot password?” on the sign-in page to reset your own password."));
        return;
      }
      if (env.MAIL_PROVIDER === "none") {
        res.status(503).json(apiError("mail_disabled", "Email isn't set up on this deploy, so a reset link can't be sent."));
        return;
      }

      // Org-scoped: the person must be a member of the CALLER's org, whatever else they belong to.
      const member = await lookupMemberRole(admin, orgId, userId);
      if (!member.ok) {
        if (member.reason === "not_found") res.status(404).json(apiError("not_found", "Member not found"));
        else res.status(500).json(apiError("db_error", "Could not load member"));
        return;
      }
      if (isRosterIssuedRole(member.role)) {
        res.status(400).json(apiError("roster_managed", "This is a driver-app login. Reset it on the Drivers page."));
        return;
      }

      const { data: user } = await admin.auth.admin.getUserById(userId);
      const email = user?.user?.email ?? null;
      // The same verdict the public route reaches, so an address that also holds a driver login is
      // refused here too rather than having the driver's password changed from the Users page.
      const target = email ? await resetTargetForEmail(admin, email) : null;
      if (!email || !target || target.userId !== userId) {
        res.status(400).json(apiError("not_resettable", "This member's password can't be reset by email."));
        return;
      }

      const issued = await issueReset(admin, env, {
        target: { userId, orgId },
        email,
        requestedBy: actorId,
        now: new Date(),
      });
      if (isResetError(issued)) {
        res.status(issued.status).json(apiError(issued.code, issued.message));
        return;
      }
      if (!issued.sent) {
        res.status(502).json(apiError("send_failed", "The email provider didn't accept the message. Nothing was sent; try again."));
        return;
      }
      res.json({ sent: true, expiresAt: issued.expiresAt });
    }),
  );

  return router;
}
