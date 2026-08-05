# Driver credentials — company-issued username + password (Samsara model)

**Status:** IMPLEMENTED (commit `6ea16a9` + follow-up). Delivered exactly as planned with two noted
deviations: the credential modal ships copy-to-clipboard instead of a print-handout view (add later if
paper handouts are wanted), and the API accepts `VITE_SUPABASE_ANON_KEY` as the anon-key fallback so
the single-service Railway env needs no new variable. Remaining HUMAN checklist item (A2): in the
Supabase dashboard set auth password min length ≥ 12 and enable leaked-password protection.
**Supersedes** the driver-invite flow (plan D1/D3): the org decided
drivers will NOT self-register via email invites. Instead the company creates each driver's login
(username + generated password), hands it out, and controls it end-to-end — exactly how Samsara issues
driver alpha codes. Email invites remain for OFFICE roles only; `invites.driver_id` is retired.

**Why this model:** the company pays for the seat, so the company owns the credential. Admins can
create, reset, disable, and revoke logins at will; a departed driver can be cut off instantly; there is
no dependence on drivers' personal email; and no password-recovery email flow exists for drivers to
abuse or phish.

---

## 0. What already exists (verified in code — build ON it)

- Supabase Auth (email + password) with `custom_access_token_hook` (0006) injecting `org_id` +
  `user_role` claims from memberships. RLS reads these via `auth_org_id()` / `auth_role()`.
- `auth_driver_id()` (0083) + `drivers.user_id` — the binding that scopes the driver app; the invite
  ACCEPT flow (routes/invites.ts) already implements linking + double-link guards. Reuse that logic.
- Offboarding (D14, routes/members.ts / me.ts): membership removal + global sign-out +
  `device_push_tokens` revoke + duty-session close. Reuse as "Revoke login".
- `drivers.samsara_username` — the driver's existing Samsara alpha code (e.g. "aaron"). Default the
  FuelGuard username to it so a driver carries ONE login habit across both apps.
- Driver app `SessionProvider.signIn(email, password)` → `supabase.auth.signInWithPassword`.

## 1. Decisions

| # | Decision | Rationale |
|---|---|---|
| DC1 | Driver identity = **org-issued username** (`[a-z0-9._-]{3,32}`, unique per org, defaulted from `samsara_username`, admin-editable) | One familiar login per driver; no personal email dependence |
| DC2 | Each credential is a normal Supabase Auth user whose email is **synthetic + non-deliverable**: `<username>@drivers.fuelguard.app` (created with `email_confirm: true`; no mail is ever sent). Multi-tenant later: suffix an org code before the `@` | Keeps ONE auth system (JWT hook, RLS, sessions all unchanged); Samsara does the same under the hood |
| DC3 | Passwords are **system-generated** (16 chars, unambiguous alphabet), **shown exactly once** at create/reset, stored ONLY in Supabase Auth (bcrypt). Drivers **cannot change** their password in-app; "forgot password" = contact dispatch | Company control is the whole point; no recovery email surface to abuse |
| DC4 | Lifecycle lives on the **Drivers page**: Create login · Reset password · Disable · Enable · Revoke — admin/fleet_manager only, every action audited (actor + driver + action, NEVER the secret) | Same place admins already manage drivers; auditable control |
| DC5 | Login goes through **`POST /api/auth/driver-login`** `{ username, password }` → server resolves username → synthetic email → signs in with the ANON client server-side → returns the Supabase session to the app (`setSession`). Uniform `invalid_credentials` error for unknown-user AND wrong-password; per-IP + per-username throttle | Hides the synthetic-email scheme, prevents username enumeration, gives one place to rate-limit and audit failed logins |
| DC6 | **Disable** = `auth.admin.updateUserById(banned)` + global sign-out + push-token revoke (temporary hold, e.g. seasonal). **Revoke** = existing D14 offboarding (permanent). Enable lifts the ban | Instant cutoff either way; distinguishes "paused" from "gone" |
| DC7 | Migration **0116**: `drivers.app_username text` (unique per org, partial index), `app_credential_status text` (`none｜active｜disabled`), `app_credential_created_at` / `app_credential_reset_at timestamptz`. schemaCheck probe + RLS gate already enforce coverage | Dashboard state without touching auth internals; status is display-state, Supabase Auth stays the source of truth |
| DC8 | The one-time password is returned ONCE in the create/reset API response and rendered in a copy/print modal. It is never persisted in our tables, never logged, never in audit meta | Show-once is the industry pattern; anything else becomes a stored secret |
| DC9 | Driver app login screen: **username + password** fields (no email keyboard), calls DC5, then `supabase.auth.setSession(...)`. Remove/never add forgot-password UI for drivers | Matches what the driver is handed on paper |

## 2. Audit FIRST (assume nothing — verify in code/dashboard before building)

- A1 `custom_access_token_hook` — confirm claims come from `memberships`; a driver credential must get a
  `role='driver'` membership row at create time or RLS sees no org. (Read 0006 + memberships schema.)
- A2 Supabase project settings: email confirmations OFF for admin-created users (`email_confirm: true`
  covers it), password min length ≥ 12, and **leaked-password protection ON** if available.
- A3 GoTrue ban support in the installed supabase-js: `auth.admin.updateUserById({ ban_duration })` —
  verify exact field + behavior for Disable.
- A4 Existing driver logins (if any drivers already linked via `drivers.user_id`) — migration path:
  keep them working; Create-login refuses when `user_id` is already set, offer Reset instead.
- A5 The API's rate limiter (does one exist? if not, in-process token bucket per IP+username on the
  DC5 endpoint; Supabase Auth's own limits back it up).
- A6 `apps/driver` release process — the login-screen change ships with a new binary; plan the cutover
  (old email logins keep working through DC5's fallback: input containing `@` is treated as an email).

## 3. Build plan

**P1 — backend (api + shared + migration).**
`services/driverCredentials.ts`: `createDriverLogin(admin, env, orgId, driverId, { username? })`,
`resetDriverPassword`, `disableDriverLogin`, `enableDriverLogin`, `revokeDriverLogin` (delegates to the
D14 offboard path), `generatePassword()` (crypto-random, 16 chars, no ambiguous glyphs — pure +
tested). Endpoints under `routes/roster` (admin/fleet_manager): POST create, POST reset, POST disable,
POST enable, DELETE. `POST /api/auth/driver-login` is UNAUTHENTICATED (it IS login): resolve
`drivers.app_username` (org-agnostic while single-tenant), sign in server-side with the anon key,
return `{ access_token, refresh_token, expires_at }`; uniform error + throttle + audit on failure.
Zod contracts in `packages/shared` (`driverAuthContract.ts`). Migration 0116 per DC7. Unit tests for
every service fn (fake supabase pattern) + password generator; tsc/eslint/size/boundary/RLS gates.

**P2 — dashboard (web).** Drivers page: "App access" column (none / active / disabled badge +
username) and row actions per DC4. Create/Reset open a modal: username + one-time password, copy
buttons, "print handout" view. All actions confirm; Revoke double-confirms.

**P3 — driver app.** Login screen → username + password; `@`-containing input treated as legacy email
login (A6 cutover). Sign-in calls DC5 then `setSession`. "Forgot password? Ask dispatch to reset it."
No other app changes — sessions, claims, RLS scoping all behave exactly as today.

**P4 — hardening + docs.** Failed-login audit trail (`auth.driver_login_failed`, bucketed), throttle
tuning, Settings → Users copy noting driver logins live on the Drivers page now, retire
`invites.driver_id` path (leave accept-flow code for office invites), update DRIVER-APP-PLAN.md
decision log (D1 superseded by DC1–DC9).

## 4. Security posture (what an auditor will ask)

- Passwords: generated server-side from `crypto.randomBytes`, bcrypt-hashed by Supabase Auth, shown
  once, never stored/logged by us. Company can rotate any credential at any time.
- No self-service recovery for drivers → no phishable reset email; recovery is a human process
  through dispatch (reset → new one-time password).
- Enumeration: one uniform error; constant-ish response time; per-IP + per-username throttle; failures
  audited with source IP.
- Instant revocation: ban/offboard + `signOut(global)` + push-token revoke; JWT lifetime is 1h so even
  a captured token dies fast.
- Blast radius: the synthetic-email user carries ONLY a `driver` membership; RLS driver scopes (0083+)
  already restrict every table to self-rows. No new policies needed.

## 5. Definition of done

Admin creates a login from the Drivers page and reads the one-time password off the modal; the driver
signs into the app with username + password; reset/disable/enable/revoke all work from the row and are
audited; a disabled driver is signed out within seconds; failed logins are throttled + audited; all
suites/gates green; 0116 applied; this doc's decision table updated with anything learned.
