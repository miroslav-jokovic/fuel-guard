-- Silvicom 360 — 0615 signed-in devices: list a person's sessions, end one
-- (INSTALLED-APP-PLAN IA-S3; Q-IA3 (b), ruled by the owner 2026-11-15)
--
-- Today a lost phone can only be handled by changing the password: nothing shows a person where they are
-- signed in, and nothing ends one device without ending all of them (`revoke_user_sessions`, 0363). The owner
-- ruled that each person may end their own devices and an admin anybody's in their company. This file is the
-- schema half; the routes and the dialog are the next merge (a new function and its first reader ship in two
-- merges, as 0603 and 0614 did).
--
-- 1. WHAT A "DEVICE" IS. One row of `auth.sessions`, which Supabase's auth server writes at sign-in and
--    touches at every token refresh. Measured on production 2026-11-15 (106 rows, aggregates only): `user_agent`
--    and `ip` are set on every row; `updated_at` is set on every row and equals `refreshed_at` to the second
--    wherever that is set (40 rows) — so `updated_at` is "last used" for all of them, and `refreshed_at`
--    (a timestamp WITHOUT a zone) is not read here at all; `not_after` is set on none. One person held 47
--    sessions: every sign-in that was never signed out of is a row, which is why the list is worth having.
--
-- 2. NOTHING OF A TOKEN LEAVES THIS FILE. The reader returns the session's id, three instants, the user agent
--    and the address — never `refresh_token_hmac_key`, never a refresh token (those live in
--    `auth.refresh_tokens`, which is not read).
--
-- 3. WHO IS ASKED ABOUT IS CHECKED HERE; WHO IS ASKING IS THE API'S. Both functions require the person to hold
--    a membership in the organisation they are called for — any role, suspended or not, because a driver's
--    phone and a suspended dispatcher's PC are exactly the sessions an admin needs to end. Whether the caller
--    is that person or an admin of that organisation is decided by the route from the verified token: writing
--    "admin" here would be a second copy of the role matrix (lint:section-policies).
--    ⚠ A session belongs to a PERSON, not to an organisation. Somebody with memberships in two organisations
--    has one set of sessions, and an admin of either can see and end them — as `revoke_user_sessions` already
--    lets either do for all of them at once.
--
-- 4. ENDING ONE IS A DELETE, as 0363's is for all: `auth.refresh_tokens.session_id` and
--    `auth.mfa_amr_claims.session_id` cascade (measured on production 2026-09-23), and `postgres` holds SELECT
--    and DELETE on `auth.sessions` (measured again 2026-11-15). The session must be that person's: an id that
--    is somebody else's ends nothing and answers 0.
--    ⚠ An ACCESS token already issued to that device stays valid until it expires (jwt_expiry, 1 hour): the API
--    verifies a token's signature and its membership (SP7), not that its session still exists. So "ended"
--    means "cannot renew" at once and "cannot call" within the hour. Closing that hour is INSTALLED-APP-PLAN
--    Q-IA10 and is not done here.
--
-- Both are `plpgsql`, for 0363's reason: this file must not require `auth.sessions` to exist at CREATE time —
-- the PGlite matrices shim `auth.users` only, and the matrix for this file builds its own `auth.sessions`.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: two new functions that nothing calls; no table, column or existing
-- function is changed.
--
-- Rollback: drop the two functions — after the next merge's routes and dialog are reverted.

-- ── 1. A person's sessions, most recently used first ──────────────────────────────────────────────
create or replace function member_sessions(p_org uuid, p_user uuid)
returns table (id uuid, created_at timestamptz, last_used_at timestamptz, user_agent text, ip text, expires_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.memberships mb where mb.org_id = p_org and mb.user_id = p_user) then
    return;
  end if;
  return query
    select s.id, s.created_at, coalesce(s.updated_at, s.created_at), s.user_agent, host(s.ip), s.not_after
      from auth.sessions s
     where s.user_id = p_user
       and (s.not_after is null or s.not_after > now())
     order by coalesce(s.updated_at, s.created_at) desc nulls last, s.id;
end;
$$;

-- ── 2. End one of them ────────────────────────────────────────────────────────────────────────────
-- Returns how many were ended: 1, or 0 when the session is not that person's, is already gone, or the person
-- is not of that organisation. Never an error for "not found" — two people pressing End on the same row must
-- both get an answer.
create or replace function member_session_end(p_org uuid, p_user uuid, p_session uuid)
returns integer
language plpgsql volatile security definer set search_path = ''
as $$
declare
  n integer;
begin
  if p_session is null
     or not exists (select 1 from public.memberships mb where mb.org_id = p_org and mb.user_id = p_user) then
    return 0;
  end if;
  delete from auth.sessions s where s.id = p_session and s.user_id = p_user;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── Grants: service role only ─────────────────────────────────────────────────────────────────────
revoke all on function member_sessions(uuid, uuid) from public, anon, authenticated;
revoke all on function member_session_end(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function member_sessions(uuid, uuid) to service_role;
grant execute on function member_session_end(uuid, uuid, uuid) to service_role;

comment on function member_sessions(uuid, uuid) is
  'A member''s auth.sessions rows as devices: id, created, last used, user agent, address — never a token (IA-S3).';
comment on function member_session_end(uuid, uuid, uuid) is
  'Deletes ONE of a member''s auth.sessions rows, cascading its refresh tokens; 0 when it is not theirs (IA-S3).';
