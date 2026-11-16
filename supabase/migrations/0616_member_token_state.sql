-- Silvicom 360 — 0616 a signed-out device stops working at once, not within the hour
-- (INSTALLED-APP-PLAN Q-IA10 (a), ruled by the owner 2026-11-15)
--
-- An access token lives an hour. `requireAuth` already refuses one whose MEMBERSHIP changed since it was minted
-- (SP7, `apps/api/src/middleware/membershipCurrent.ts`: one read of `memberships` per person per 15 seconds).
-- It does not ask whether the token's SESSION still exists — so a device signed out from "Signed-in devices"
-- (0615), or by a password reset, a suspension or a removal, keeps calling the API until its token expires.
-- Seen on staging 2026-11-15: a session ended at 21:49 UTC could not renew, and its token still got 200.
--
-- This file is the schema half: ONE function that answers both questions in the round trip the API already
-- makes. The API's reader is the next merge (a new function and its first reader ship in two merges).
--
-- 1. THE SAME READ, NOT A SECOND ONE. `member_token_state` returns what `membershipVerdict` reads today —
--    the membership's role and whether it is suspended — plus `session_alive`. Zero rows when there is no
--    membership, exactly as the table read answers today. Measured on production 2026-11-15: the read it
--    replaces ran 106,108 times in 41 days at a mean of 0.045 ms (4.8 s of 45,600 s of database work), and a
--    session lookup by id is an index-only read of 5 buffers.
--
-- 2. THREE ANSWERS, AND "CANNOT TELL" IS ONE OF THEM. `session_alive` is true when the session exists, is
--    that person's and is not past its own end; false when it does not; and NULL when no session was named —
--    a token without the claim. The API reads NULL as "cannot tell" and lets the signed token stand, as it
--    does for a read that fails: a rule that locked everybody out on an unreadable claim would be an outage
--    of our own making.
--
-- 3. THE SESSION MUST BE THAT PERSON'S. A token naming somebody else's live session is not alive.
--
-- `plpgsql`, for 0363's and 0615's reason: this file must not require `auth.sessions` to exist at CREATE time —
-- the PGlite matrices shim `auth.users` only; the matrix for this file builds its own `auth.sessions`.
--
-- WHAT IT STILL DOES NOT REACH: the browser's direct database reads (RLS), which honour a token until it
-- expires (SETTINGS-PERMISSIONS-PLAN §4b). The hour is closed for the API, where the writes are.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: one new function that nothing calls; nothing existing is changed.
--
-- Rollback: drop the function — after the next merge's reader is reverted.

create or replace function member_token_state(p_org uuid, p_user uuid, p_session uuid)
returns table (role user_role, suspended_at timestamptz, session_alive boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_alive boolean;
begin
  if p_session is not null then
    select exists (
      select 1 from auth.sessions s
       where s.id = p_session and s.user_id = p_user
         and (s.not_after is null or s.not_after > now())
    ) into v_alive;
  end if;
  return query
    select mb.role, mb.suspended_at, v_alive
      from public.memberships mb
     where mb.org_id = p_org and mb.user_id = p_user;
end;
$$;

revoke all on function member_token_state(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function member_token_state(uuid, uuid, uuid) to service_role;

comment on function member_token_state(uuid, uuid, uuid) is
  'What requireAuth needs to know about a token in one read: the membership''s role and suspension, and whether the token''s session still exists (Q-IA10).';
