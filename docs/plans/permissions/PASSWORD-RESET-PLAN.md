# Password reset — an office user who forgot their password can get back in

**Status: BUILT** on `claude/password-reset` (migration 0363). Decision-log document per house
convention; decision IDs `D-PWR*`. Written 2026-09-23 against `origin/main` e5a958b, migrations
through 0362.

**Owner ruling, 2026-09-23** (verbatim intent): "add reset password option to users … secure and
enterprise grade", then "go with your recommendations, build it" on the four questions in §4.

---

## §0 Ground truth (measured 2026-09-23)

- **No office user could reset a password.** The login page said "Access is invite-only"; no
  screen, no endpoint. The only road that worked was SQL: delete the person's ACCEPTED `invites` row
  by hand (every endpoint refuses an accepted row), write its `invite.deleted` audit row by hand, and
  re-invite so `ensureLoginForInvite` resets the password as a side effect. Done for george@ on
  2026-09-21 and pavlin@ on 2026-09-23.
- **Drivers already have one, deliberately different.** DRIVER-CREDENTIALS-PLAN DC3/DC4: generated,
  shown once, reset by the office on the Drivers page; no recovery email. Out of scope and untouched.
- **GoTrue's own recovery email is the wrong tool** for the three reasons `apps/api/src/lib/linkToken.ts`
  records against its invitation token: a mail scanner spends it on delivery, it lives on the
  project's OTP clock (one hour by default) rather than ours, and a second request kills the first.
- Production: 12 users, 0 with more than one membership, 0 non-email identities.
- `auth.sessions` ← `auth.refresh_tokens.session_id` and `auth.mfa_amr_claims.session_id` are both
  `ON DELETE CASCADE`; `postgres` holds DELETE on both.
- Three password floors in the repo for one fact: the invite page said 8, `inviteRedeemSchema` said 8,
  `supabase/config.toml` says 6.

## §1 Decisions

- **D-PWR1 — the link is ours.** A 256-bit token from `mintLinkToken`; the table holds its SHA-256
  (`CHECK token_hash ~ '^[0-9a-f]{64}$'`, so the raw token cannot be stored by mistake).
- **D-PWR2 — one live link per person.** A new request revokes the old first; a partial unique index
  makes two live rows impossible even under a race.
- **D-PWR3 — spending is one conditional UPDATE, before the password is set.** If GoTrue then refuses
  the password, the claim is released so the same link still works.
- **D-PWR4 — rows are person-keyed.** `org_id` is carried for audit, retention and the RLS harness;
  the revoke/claim queries are by `user_id` or token hash. A person in two orgs gets their oldest
  office membership's org.
- **D-PWR5 — who may reset is a verdict in TypeScript.** `password_reset_candidates()` returns every
  membership; `pickResetTarget` refuses any address that holds a roster-issued (driver) membership,
  read from `isRosterIssuedRole`. Re-checked at spend time.
- **D-PWR6 — a completed reset signs the person out everywhere** (`revoke_user_sessions`, which is
  GoTrue's global logout by id). ⚠ An already-issued ACCESS token lives until it expires (1 hour).
- **D-PWR7 — one password rule**, `passwordResetContract.ts`: 12–72 characters, no composition rule
  (NIST 800-63B), not one repeated character, not containing the email's local part. Used by the
  invite page, the reset page and the API. The invitation floor rises from 8 to 12 with it.
- **D-PWR8 — an admin can SEND a reset, never see or set one.** `POST /api/members/:id/password-reset`
  is admin-only, step-up gated, org-scoped, refuses self and drivers, and refuses outright when mail
  is off — no "copy the link" fallback, because a link in the admin's hands is the admin choosing a
  colleague's password.

Also: the public `request` answers 202 with one sentence **before** it looks the address up, so
neither content nor timing says whether an account exists. Per-person budget 3 links/hour, counted
in the table (survives restarts, holds across both Railway services); prefix limiter 30 per
15 minutes per address. Audit actions: `auth.password_reset_requested` (via self|admin, sent),
`auth.password_reset_throttled`, `auth.password_reset_completed` (sessionsEnded, noticeSent). The
token and the password never appear in a log or an audit row. A "your password was changed" email
follows every completed reset. Retention: 30 days on `password_resets`; the audit rows are forever.

## §2 What shipped

| Piece | Where |
|---|---|
| Table + two service-role functions | `supabase/migrations/0363_password_resets.sql` |
| Rule, contracts, emails | `packages/shared/src/passwordResetContract.ts`, `passwordResetEmail.ts` |
| Service | `apps/api/src/modules/org/passwordReset.ts` |
| Public routes | `apps/api/src/modules/org/routes/publicPasswordReset.ts` → `/api/public/password-reset` |
| Admin route | `apps/api/src/modules/org/routes/memberPasswordReset.ts` → `/api/members/:id/password-reset` |
| Pages | `/forgot-password`, `/reset-password`; "Forgot password?" on `/login` |
| Users page | "Send password reset…" in the member kebab → `MemberPasswordResetDrawer.vue` |
| Tests | `passwordReset.test.ts`, `passwordResetRoutes.test.ts`, `passwordResetContract.test.ts`, `ResetPasswordPage.test.ts`, `supabase/tests/password-resets.test.mjs`, `rls.test.mjs` seed |

## §3 Owed by the owner (no gate can see these)

1. **Supabase dashboard → Authentication → Passwords**: set the minimum length to 12 so GoTrue agrees
   with D-PWR7, and switch on **leaked-password protection** (HaveIBeenPwned). I believe that one
   needs the Pro plan; not verified. Until it is on, the rule is ours alone.
2. **Mail provider is Brevo**, and `env.ts` already warns that Brevo click-tracking stores every
   emailed link in its event log — which now includes reset links, not only invitations. A reset
   link lives an hour and is single-use, which bounds the exposure but does not remove it. The fix is
   the one `env.ts` names: move to Resend.

## §4 Open questions

- **Q-PWR1 — MFA.** TOTP/WebAuthn for office users. Out of scope by ruling; the natural next step.
- **Q-PWR2 — "change password" for a signed-in user.** Today a signed-in user who wants a new
  password uses "Forgot password?". A settings screen would need a current-password check (the
  step-up grant is the precedent). Recommended next, small.
- **Q-PWR3 — access-token lifetime.** D-PWR6 cannot end an access token already issued; only a
  shorter `jwt_expiry` (D31 = 1 hour) narrows that. Not proposed — it costs every user a refresh.

## Progress log

- 2026-09-23 — plan written and built in one PR; all gates run locally before push.
