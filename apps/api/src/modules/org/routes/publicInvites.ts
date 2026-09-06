import { Router } from "express";
import { inviteLookupSchema, inviteRedeemSchema, type InviteLookupRequest, type InviteRedeemRequest } from "@silvicom/shared";
import { apiError, asyncHandler, validateBody } from "../../../lib/http.js";
import { getAppLocals } from "../../../lib/appLocals.js";
import { getSupabaseAdmin } from "../../../lib/supabaseAdmin.js";
import { admitInvitedUser, ensureLoginForInvite, isRedemptionError, resolveInviteByToken } from "../inviteRedemption.js";

/**
 * Where an emailed invitation is turned into an account — unauthenticated by necessity, because
 * the person has no account yet. The LINK is the credential (`lib/linkToken.ts`), and it is
 * presented in the body of a POST, never in a path or query string, so it does not land in access
 * logs on the way.
 *
 * Two verbs, and the split between them is the whole design:
 *
 *  · `lookup` READS. It says who the invitation is for and which organisation it joins, so the page
 *    can show a form that already knows the answers, and it says `invalid_link` before anybody types
 *    a password. It spends nothing — a mail-security scanner that renders the page and lets this
 *    call run has learned the org's name and stopped.
 *  · `redeem` SPENDS. It needs a password, which is the one thing a scanner does not have. Only
 *    here is the login created and the membership written.
 *
 * `publicApplication.ts` is the precedent for the shape (rate-limited, uniform refusals, the token
 * resolving the org server-side so no tenant id crosses the boundary), and the risk here is smaller:
 * nothing personal is collected, and the worst a guessed token could do — at 256 bits, nothing — is
 * accept a membership on the holder's behalf.
 */
export function publicInvitesRouter(): Router {
  const router = Router();

  router.post(
    "/lookup",
    validateBody(inviteLookupSchema),
    asyncHandler(async (req, res) => {
      const admin = getSupabaseAdmin(getAppLocals(req).env);
      const { token } = res.locals.body as InviteLookupRequest;
      const found = await resolveInviteByToken(admin, token, new Date());
      if (isRedemptionError(found)) {
        res.status(found.status).json(apiError(found.code, found.message));
        return;
      }
      res.json({
        email: found.invite.email,
        orgName: found.org.name,
        role: found.invite.role,
        fullName: found.invite.full_name,
        expiresAt: found.invite.expires_at,
      });
    }),
  );

  router.post(
    "/redeem",
    validateBody(inviteRedeemSchema),
    asyncHandler(async (req, res) => {
      const env = getAppLocals(req).env;
      const admin = getSupabaseAdmin(env);
      const { token, password, fullName } = res.locals.body as InviteRedeemRequest;

      const found = await resolveInviteByToken(admin, token, new Date());
      if (isRedemptionError(found)) {
        res.status(found.status).json(apiError(found.code, found.message));
        return;
      }
      const { invite, org } = found;

      const login = await ensureLoginForInvite(admin, env, invite.email, password);
      if (isRedemptionError(login)) {
        res.status(login.status).json(apiError(login.code, login.message));
        return;
      }

      const admitted = await admitInvitedUser(admin, {
        invite,
        org,
        userId: login.userId,
        email: invite.email,
        typedName: fullName ?? null,
      });
      if (isRedemptionError(admitted)) {
        res.status(admitted.status).json(apiError(admitted.code, admitted.message));
        return;
      }
      // The page signs in with the password it just set; the token minted then already carries the
      // org and role claims, because the membership exists before the sign-in happens.
      res.json({ ok: true, email: invite.email, orgId: admitted.orgId, role: admitted.role });
    }),
  );

  return router;
}
