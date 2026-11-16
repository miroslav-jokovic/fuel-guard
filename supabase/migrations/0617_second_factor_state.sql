-- Silvicom 360 — 0617 two-step sign-in for the office app: when it starts, and who has one
-- (INSTALLED-APP-PLAN IA-S1; Q-IA1 (b), Q-IA12 (b), Q-IA13 as proposed — the owner's rulings of 2026-11-15)
--
-- Ruled: an authenticator code is REQUIRED for the admin role and optional for everybody else; existing admins
-- get 14 days of notice before it is required. This file is the schema half — one date per company and one
-- function. The API's reader, the sign-in screens and the recovery routes are later merges (a column and a
-- new function ship before their first reader).
--
-- 1. THE DATE IS THE COMPANY'S. `organizations.second_factor_required_from`: from this instant an admin of
--    that company needs a second factor to use the API. It is a column and not a constant because the 14 days
--    must start when the feature reaches THAT database — this statement runs on staging at merge and on
--    production at the release — and because a company created next year gets its own 14 days (the column's
--    default). Existing companies get the same: now + 14 days, at the moment this applies.
--
-- 2. FACTS HERE, THE RULE IN THE API. `member_access_state` returns what `member_token_state` (0616) returns —
--    role, suspension, whether the session is alive — plus two FACTS: the company's date, and whether this
--    person has a verified factor. WHO is required is not decided in SQL: "the admin role" is `isAdmin` in
--    `@silvicom/shared`, and writing 'admin' here would be the second copy of a role rule that
--    lint:section-policies exists to stop. The API combines them: required when the person has a factor
--    (anybody who turned it on means it), or is an admin of a company whose date has passed.
--
-- 3. IT SUPERSEDES 0616's FUNCTION, WHICH STAYS. `member_token_state` is called by the code now being
--    released; changing a function's result columns means dropping it, and dropping it under running code is
--    the outage the two-merge rule exists to prevent. So this is a NEW function with the superset; the API moves
--    to it in its next merge, and 0616's is dropped a release after its last reader is gone.
--
-- 4. A FACTOR IS SUPABASE'S. `auth.mfa_factors` (measured on production 2026-11-15: one row, verified, `totp`)
--    is read, never written: enrolling, verifying and removing go through Supabase's own API, so its own
--    bookkeeping (sessions, challenges) stays its own. Only `status = 'verified'` counts — an enrolment
--    started and abandoned is a QR code nobody scanned.
--
-- `plpgsql`, for 0363's reason: this file must not require `auth.sessions` or `auth.mfa_factors` to exist at
-- CREATE time — the PGlite matrices shim `auth.users` only; the matrix for this file builds both.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: one NOT NULL column with a default that nothing reads, and one new
-- function nothing calls. No existing function or policy is changed, and no role setting is made.
--
-- Rollback: drop the function and the column — after the reader's merge is reverted.

-- ── 1. When it starts, per company ────────────────────────────────────────────────────────────────
alter table organizations
  add column if not exists second_factor_required_from timestamptz not null default (now() + interval '14 days');

comment on column organizations.second_factor_required_from is
  'From this instant an admin of this company needs a second factor to use the API (IA-S1). Set to 14 days after the column, or the company, was created.';

-- ── 2. What the API needs to know about a token, in one read ──────────────────────────────────────
create or replace function member_access_state(p_org uuid, p_user uuid, p_session uuid)
returns table (
  role user_role,
  suspended_at timestamptz,
  session_alive boolean,
  second_factor_required_from timestamptz,
  has_second_factor boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_alive boolean;
  v_factor boolean;
begin
  if p_session is not null then
    select exists (
      select 1 from auth.sessions s
       where s.id = p_session and s.user_id = p_user
         and (s.not_after is null or s.not_after > now())
    ) into v_alive;
  end if;
  select exists (
    select 1 from auth.mfa_factors f where f.user_id = p_user and f.status::text = 'verified'
  ) into v_factor;
  return query
    select mb.role, mb.suspended_at, v_alive, o.second_factor_required_from, v_factor
      from public.memberships mb
      join public.organizations o on o.id = mb.org_id
     where mb.org_id = p_org and mb.user_id = p_user;
end;
$$;

revoke all on function member_access_state(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function member_access_state(uuid, uuid, uuid) to service_role;

comment on function member_access_state(uuid, uuid, uuid) is
  'One read for requireAuth: membership role and suspension, whether the token''s session is alive, the company''s second-factor date and whether the person has a verified factor (IA-S1). Supersedes member_token_state (0616).';
