# Phase 1 — Identity, Auth & Access Control

> Make drivers first-class login users who can use the driver app and **nothing else**: relax the
> invite domain rule for drivers, wire the dead `drivers.user_id` link, gate drivers out of the web
> dashboard, add driver-scoped RLS, and build in-app sign-in with a secure, offline-tolerant session.
> Status: **☐ not started** · Depends on: Phase 0 · Blocks: Phases 2–4
> Parent: [00-DRIVERS-APP-MASTER-PLAN.md](./00-DRIVERS-APP-MASTER-PLAN.md)

---

## Goal & demoable outcome

An admin opens the FuelGuard web dashboard, invites a driver by **personal email** (`role: driver`).
The driver receives the branded email, opens the link **in the driver app**, sets a password, and
signs in. The app resolves them to their own `drivers` row and scopes all data to them. If that same
driver tries to sign in to the **web dashboard**, they're redirected out. The offline RLS matrix
proves a driver can read only their own scope. All backend changes are additive.

---

## 0. Preconditions

- **O3 (from master §12):** confirm the **Custom Access Token hook is enabled** in the target
  Supabase project (it's commented out in `supabase/config.toml`). Without it, no `org_id`/`user_role`
  claims are issued and every tenant call fails `no_membership`. Verify in Supabase Dashboard →
  Authentication → Hooks before starting. Record the result here.

---

## 1. Identity model (what "a driver" becomes)

Two concepts exist today and must be joined:

- **`memberships`** `(org_id, user_id → auth.users, role)` — the login identity + org + role the JWT
  hook reads. Accepting a driver invite already creates this with `role='driver'`.
- **`drivers`** `(id, org_id, user_id **nullable**, full_name, employee_id, phone, status, samsara_driver_id, …)`
  — the roster record fuel transactions attribute to. **`user_id` is never populated today and has
  no unique constraint** (verified: no migration/route/web mutation writes it).

**Target:** when a driver accepts their invite, their `drivers.user_id` is set to their auth user id
(unique per org), so `auth.uid()` deterministically resolves to exactly one `drivers` row. That row
is the anchor for "my fills / my vehicle / my score."

**Provisioning decision D3 (LOCKED):** an invite with `role='driver'` should be tied to a specific
roster driver. The admin **selects an existing `drivers` record** (or creates one) at invite time; the
invite carries a `driver_id`. On accept, we set that driver's `user_id`. This avoids ambiguous
matching and keeps attribution correct. *(Alternative — match by email/phone on accept — rejected as
error-prone; drivers often share or lack unique emails.)*

---

## 2. Backend changes (additive; migrations from 0083)

### 2.1 `0083_driver_identity.sql`

- Add `invites.driver_id uuid null references drivers(id)` (which roster driver this invite provisions).
- Add a **partial unique index** on `drivers(org_id, user_id) where user_id is not null` (one login per
  driver, one driver per login, within an org).
- No destructive change to existing rows (all current `user_id` are null).

### 2.2 Invite creation — relax domain for drivers (API)

In `apps/api/src/routes/invites.ts` (`POST /api/invites`):

- Extend `inviteCreateSchema` (in `packages/shared/src/apiContract.ts`) to accept optional `driver_id`,
  required when `role='driver'`.
- **Domain rule:** keep `isEmailDomainAllowed` for office roles; **skip it when `role='driver'`** (D1:
  personal emails allowed for drivers). Everything else (branded email via `generateLink`, token,
  audit `invite.created`) is unchanged.
- Validation: if `role='driver'`, require `driver_id` to reference an existing, unlinked driver in the
  caller's org.

### 2.3 Invite accept — link the roster row (API)

In `POST /api/invites/accept` (`apps/api/src/routes/invites.ts`):

- After the existing membership upsert, if the invite has `driver_id`, set `drivers.user_id = auth.sub`
  for that driver (service-role, org-checked). Write an `invite.accepted` audit as today.
- Idempotent: re-accept is a no-op (unique index guards double-link).

### 2.4 Driver-scoped RLS — `0084_driver_scoped_rls.sql`

Today every org member can `select` all fleet data. Add driver-scoped policies so a `driver` JWT sees
only their own scope. Introduce a SQL helper mirroring `auth_org_id()`:

```sql
-- resolves the caller's driver row within their org (null for non-drivers)
create or replace function auth_driver_id() returns uuid language sql stable as $$
  select d.id from drivers d
  where d.org_id = auth_org_id() and d.user_id = auth.uid()
  limit 1
$$;
```

Policies (additive — existing manager/admin policies untouched):

| Table | Driver policy |
|---|---|
| `fuel_transactions` | `select` own rows (`driver_id = auth_driver_id()`); `insert` own rows only (tighten `ftxn_insert` so a driver can't insert for another driver). |
| `vehicles` | `select` the driver's assigned vehicle(s) (`assigned_driver_id = auth_driver_id()`). |
| `drivers` | `select` own row only. |
| `driver_performance_weeks` (later) | `select` own row only (reserved for Phase 4). |

Append every policy to the **offline RLS matrix** (`supabase/tests/rls.test.mjs`) with assertions:
a driver reads their own fill/vehicle/driver row; a driver **cannot** read another driver's rows;
managers/admins are unaffected.

> Design note: drivers keep the ability to `insert` fuel_transactions (existing `ftxn_insert` allows
> `driver`), which is why capture can stay largely client-direct — but Phase 3 adds a server capture
> endpoint so **scoring runs server-side** (the current `/api/transactions/:id/score` is manager-only).

### 2.5 Web dashboard gate (web)

In `apps/web/src/router/index.ts` `beforeEach`: if the authenticated user's `user_role === 'driver'`,
redirect to a friendly "Use the FuelGuard Driver app" screen (or `signOut`) instead of `/`. This closes
the gap where a driver login currently lands on the dashboard and reads data. UI-only defense-in-depth;
real enforcement stays RLS + `requireRole`.

### 2.6 Driver context read (API) — `GET /api/me/driver`

A small endpoint returning the caller's driver row + assigned vehicle(s) (server resolves via
`auth_driver_id()`), so the app has a single trusted bootstrap call. Guarded by `requireAuth` +
`requireRole('driver')`. Shape defined as a Zod schema in `packages/shared` (reused by the app).

---

## 3. App changes (Expo)

### 3.1 Supabase client for RN — `src/lib/supabase.ts`

`createClient(url, anonKey, { auth: { storage: <secure adapter>, autoRefreshToken: true,
persistSession: true, detectSessionInUrl: false } })`.

- **Session storage:** `expo-secure-store` (encrypted) for tokens; fall back to AsyncStorage only for
  non-sensitive cache. (Team convention for native: refresh token in OS secure storage — see hazmat H10 / training §9.)
- Wire `AppState`-driven `startAutoRefresh/stopAutoRefresh` so tokens refresh when the app foregrounds.
- Env via `app.config.ts` `extra` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `API_URL`) — only public,
  `VITE_`-equivalent values; never the service-role key.

### 3.2 Auth + session — `src/features/auth/`

- **Sign-in screen:** email + password (`signInWithPassword`), large targets, show-password toggle,
  clear error states. Reuse shared validation where present.
- **Session store** (Context or Zustand): holds the Supabase `Session`; subscribes to
  `onAuthStateChange`; derives `userId/email/orgId/role/hasOrg` by decoding (not verifying) JWT claims
  (`decodeClaims` ported as a tiny base64 helper — no `atob` in RN; use `Buffer`/`base64`).
- **"Account pending"** state when `hasOrg === false` (no membership yet), mirroring the web.
- **Accept-invite / set-password flow:** handle the invite deep link (`fuelguard://…` scheme reserved
  in Phase 0) → `updateUser({ password })` → `POST /api/invites/accept` → `refreshSession()` to pull
  the new `org_id`/`user_role` claims. If deep-linking is deferred, support pasting the invite link /
  entering email+temporary flow; record the choice here.
- **Role guard:** if a signed-in user is somehow **not** a driver, show a "wrong app" screen (defense
  in depth; the web gate is the mirror of this).
- **apiFetch** (`src/lib/api.ts`): Bearer token from `supabase.auth.getSession()`, base URL from config
  — direct port of `apps/web/src/lib/api.ts`.

### 3.3 CORS / hosting

Add the driver app's origin (for any web-hosted auth callback) to `ALLOWED_ORIGINS` on `apps/api`.
Native requests send `Authorization: Bearer` and don't need CORS, but the deep-link/callback host might.

---

## 4. File & work breakdown

| Area | File(s) |
|---|---|
| Migrations | `supabase/migrations/0083_driver_identity.sql`, `0084_driver_scoped_rls.sql` |
| RLS matrix | append cases to `supabase/tests/rls.test.mjs` |
| API — invites | `apps/api/src/routes/invites.ts` (domain relax + `driver_id` + link on accept) |
| API — contract | `packages/shared/src/apiContract.ts` (invite schema `driver_id`), new `meDriver` schema |
| API — context | `apps/api/src/routes/me.ts` or new `meDriver.ts` (`GET /api/me/driver`) |
| Web gate | `apps/web/src/router/index.ts` + a small "use the driver app" page |
| App — client/session | `apps/driver/src/lib/{supabase.ts,api.ts,jwt.ts}`, `src/features/auth/*` |
| App — screens | sign-in, set-password/accept, account-pending, wrong-app |

---

## 5. Exit criteria

- ☐ Admin invites a driver by personal email (non-company domain) from the web dashboard — succeeds.
- ☐ Driver sets password + signs in **in the app**; session persists in secure storage; token
  auto-refreshes on foreground.
- ☐ On accept, `drivers.user_id` is set; `auth_driver_id()` resolves to the correct row.
- ☐ A driver JWT can read **only** their own fills/vehicle/driver row (RLS matrix asserts allow +
  deny); managers/admins unaffected.
- ☐ A `driver` signing into the **web** app is redirected out.
- ☐ `GET /api/me/driver` returns the driver + assigned vehicle(s).
- ☐ `pnpm typecheck && pnpm lint && pnpm build && pnpm test` green; new migrations in the RLS matrix
  (X/X); token-lint green.
- ☐ Doc updated with the O3 hook-enabled confirmation, the deep-link decision, and a verification tally.

---

## 6. Risks & mitigations

- **Custom token hook not enabled in prod** (O3) → verify before building; hard blocker if missed.
- **Personal-email invites weaken the domain guard** → scope the relaxation strictly to `role='driver'`
  **and** require a valid `driver_id`; admins still initiate every invite; audit every create/accept.
- **Driver reads leaking beyond scope** → RLS is the enforcement (not UI); every policy gets an
  explicit deny-case in the matrix.
- **Two apps, one Supabase project** → same project/anon key; the web gate + RLS scoping keep drivers
  out of manager surfaces regardless of client.

---

## Sources

`supabase/migrations/0003_core_tables.sql`, `0004_rls.sql`, `0006_auth_hook.sql`,
`supabase/tests/rls.test.mjs`, `supabase/config.toml`; `apps/api/src/routes/invites.ts`,
`apps/api/src/middleware/auth.ts`, `apps/api/src/lib/auth.ts`, `apps/api/src/routes/me.ts`;
`packages/shared/src/{apiContract.ts,auth.ts}`; `apps/web/src/router/index.ts`,
`apps/web/src/stores/session.ts`, `apps/web/src/lib/{api.ts,jwt.ts,supabase.ts}`,
`apps/web/src/pages/auth/AcceptInvitePage.vue`.
