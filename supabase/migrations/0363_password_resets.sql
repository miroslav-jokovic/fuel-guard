-- 0363 — password_resets: an office user who has forgotten their password can get back in.
--
-- docs/plans/permissions/PASSWORD-RESET-PLAN.md, D-PWR1..D-PWR8. Owner ruling 2026-09-23: "add reset
-- password option to users … secure and enterprise grade".
--
-- ── WHAT WAS WRONG ─────────────────────────────────────────────────────────────────────────────
-- An office member who forgot their password had no way back in. The login page says "Access is
-- invite-only", no screen offers a reset, and the only road that worked was the one taken for
-- pavlin@silvicominc.com on 2026-09-23 and george@ on 2026-09-21: delete the accepted `invites` row
-- by hand in SQL (every endpoint refuses an accepted row), write its audit row by hand, and invite
-- the person again so `ensureLoginForInvite` resets the password as a side effect. A password reset
-- performed as a service-role SQL session is exactly what this repo's rules exist to prevent.
--
-- ── D-PWR1 — The link is OURS, never GoTrue's recovery token ─────────────────────────────────────
-- `resetPasswordForEmail` mints the same one-time GoTrue token the invitation used until 2026-09-04,
-- and `lib/linkToken.ts` records the three ways that token lost real invitations: a mail scanner
-- spends it on delivery, it expires on the project's OTP clock rather than ours, and a second request
-- silently kills the first email. So a reset link carries a 256-bit token this API mints; this table
-- holds its SHA-256 and never the token, so a database leak yields hashes, not working links.
--
-- ── D-PWR2 — One live link per person, enforced here and not only in code ───────────────────────
-- A new request REVOKES the previous one (the API does that first), and the partial unique index
-- below makes two live rows for one user impossible even if two requests race. A reset that is
-- used, revoked, or past `expires_at` is dead; the API treats all three with one refusal.
--
-- ── D-PWR3 — Spending is one conditional UPDATE ─────────────────────────────────────────────────
-- `consumed_at` is set by `update … where consumed_at is null and revoked_at is null and expires_at
-- > now()`, so exactly one of two simultaneous submits wins. There is no read-then-write gap to race.
--
-- ── D-PWR4 — `org_id` is the org the person belonged to when they asked ─────────────────────────
-- A password belongs to the person, not the membership, so the row is keyed by `user_id`. `org_id`
-- is carried so the row can be audited and pruned per org like every other row the retention engine
-- touches, and so the tenant-isolation harness can seed it. A person in two orgs (none in production
-- on 2026-09-23: 12 users, 0 with more than one membership) gets the org of their oldest office
-- membership — the API's choice, stated there.
--
-- ── D-PWR5 — Who can be reset is a MEASUREMENT here and a VERDICT in TypeScript ─────────────────
-- `password_reset_candidates(email)` returns every membership the address holds and nothing else. It
-- does not decide which roles may reset: drivers are refused (DRIVER-CREDENTIALS-PLAN.md DC3 — a
-- driver's password is company-issued and reset from the Drivers page), and that rule lives in
-- `ROSTER_ISSUED_ROLES` in `packages/shared/src/auth.ts`. Restating it as `role <> 'driver'` here
-- would be the second copy the no-workarounds rule names.
--
-- ── D-PWR6 — A completed reset signs the person out EVERYWHERE ──────────────────────────────────
-- A reset is what somebody does when they fear their password is known. supabase-js has no admin
-- "sign out user by id" (driverCredentials.ts records the same audit), and GoTrue's own global
-- sign-out needs the user's JWT. `revoke_user_sessions` deletes the user's rows in `auth.sessions`,
-- which is what GoTrue's `logout?scope=global` does; `auth.refresh_tokens.session_id` cascades
-- (measured on production 2026-09-23: `refresh_tokens_session_id_fkey` and
-- `mfa_amr_claims_session_id_fkey`, both ON DELETE CASCADE; `postgres` holds DELETE on both).
-- ⚠ An ACCESS token already issued stays valid until it expires (jwt_expiry, D31 = 1 hour). That is
-- the same honesty members.ts states for revoke, and no function here can shorten it.
--
-- Both functions are `security definer` with an empty search path, for 0088's reason, and are
-- executable by the service role only. `plpgsql` for the revoke, so this file does not require
-- `auth.sessions` to exist at CREATE time — the PGlite matrices shim only `auth.users`.
--
-- ── WHY ONE MERGE ──────────────────────────────────────────────────────────────────────────────
-- New table, two new functions, and their first readers in the same PR. `lint:migration-ordering`
-- exempts new tables on purpose: for the ~3 minutes the API serves ahead of this file, a person who
-- asks for a reset gets the same "if an account exists…" answer and no email, and nothing that
-- already works changes.
--
-- Rollback: drop function revoke_user_sessions(uuid); drop function password_reset_candidates(text);
-- drop table password_resets.

create table if not exists password_resets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- SHA-256 hex of the emailed token (D-PWR1). Never the token.
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Null when the person asked for it themselves; the admin's id when sent from the Users page.
  requested_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  revoked_at   timestamptz,
  check (expires_at > created_at),
  check (consumed_at is null or revoked_at is null)
);

-- D-PWR2: at most one live reset per person, whatever the API does.
create unique index if not exists password_resets_one_live_per_user
  on password_resets (user_id) where consumed_at is null and revoked_at is null;
create index if not exists password_resets_org_created on password_resets (org_id, created_at);

alter table password_resets enable row level security;
-- No policies, on purpose. The service role bypasses RLS; no browser reads or writes a reset.

-- D-PWR5: every membership an address holds. The API decides which of them may reset.
create or replace function password_reset_candidates(p_email text)
returns table (user_id uuid, org_id uuid, role user_role, joined_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id, m.org_id, m.role, m.created_at as joined_at
    from auth.users u
    join public.memberships m on m.user_id = u.id
   where lower(u.email) = lower(btrim(p_email))
   order by m.created_at;
$$;

revoke all on function password_reset_candidates(text) from public, anon, authenticated;
grant execute on function password_reset_candidates(text) to service_role;

-- D-PWR6: sign a person out of every device. Returns how many sessions were ended.
create or replace function revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function revoke_user_sessions(uuid) to service_role;

comment on table password_resets is
  'Emailed password-reset links (D-PWR1..D-PWR4). token_hash only; one live row per user; spent by one conditional UPDATE. Written only by apps/api/src/modules/org/passwordReset.ts.';
comment on function password_reset_candidates(text) is
  'Every membership an email address holds (D-PWR5). A measurement: the API decides which roles may reset.';
comment on function revoke_user_sessions(uuid) is
  'Deletes the user''s auth.sessions rows, cascading their refresh tokens — GoTrue''s global sign-out, by id (D-PWR6).';
