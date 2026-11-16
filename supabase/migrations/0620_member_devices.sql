-- Silvicom 360 — 0620 signed-in devices remembered, and at most three at once
-- (INSTALLED-APP-PLAN IA-S6; the owner's rulings of 2026-11-16, Q-IA14 … Q-IA19)
--
-- Ruled: an account is signed in on at most THREE devices (Q-IA15, everybody, drivers included, no exception
-- for admins; Q-IA16 fixed, not a company setting). A fourth sign-in is STOPPED, not the oldest thrown out
-- (Q-IA14 (b)): the person is shown the three and signs one out to continue. Every device and every address it
-- used is remembered for twelve months after it was last seen (Q-IA17), shown, not acted on (Q-IA18 (a); an
-- email on a new device is next); no place names from addresses (Q-IA19).
--
-- Measured on production 2026-11-16 before writing this: 80 live `auth.sessions` rows for 19 accounts, every
-- one with `ip` and `user_agent`; 55 unused for 30 days; one admin with 47, 46 of them idle since August;
-- nobody with more than three used in the last 14 days. Supabase's own sign-in history
-- (`auth.audit_log_entries`) holds 0 rows. And a session row is DELETED at sign-out — so before this file,
-- an address was forgotten the moment the device that used it signed out.
--
-- 1. WHY OUR OWN TABLES. Supabase can limit an account to ONE session and no other number (its "User
--    sessions" guide, read 2026-11-16), and it keeps no history. `member_devices` is a device as the
--    product knows it; `member_device_addresses` every address one used. Neither is ever written by a
--    sign-out, so the history outlives the session — that is the point of them.
--
-- 2. A DEVICE IS NOT A SESSION. Each app keeps a random key of its own (`p_device_key`, sent by the app with
--    every request) so the office PC that signs out on Friday and in on Monday is ONE device, still in its
--    place, not a second one. An app that sends no key (an old build) is keyed by its session, which is
--    exactly the device-equals-session rule it had before. A session is bound to ONE device at first sight
--    and a later key on the same session is ignored — otherwise one token sending a fresh key per request
--    could write rows without end.
--
-- 3. ADMISSION, NOT RANKING. A device takes one of the three places the first time the API sees it, and
--    keeps it while its session is alive. A device NOT admitted writes nothing — so the fourth sign-in that
--    was stopped and then abandoned (the tab closed on the "three devices" page) never takes a place. Ranking
--    every live session by age was considered and rejected for that reason: the abandoned attempt would
--    outrank the person's next real one.
--
--    "Holding a place" is Supabase's session row not expired AND the device seen by the API within `p_idle_hours`, which the API passes from
--    `SESSION_IDLE_HOURS` in `@silvicom/shared` — the inactivity sign-out the owner ruled (Q-IA2: 12 h).
--    ⚠ That number restates a Supabase dashboard setting this database cannot read. Until the owner turns
--    the 12 h inactivity timeout ON there, a device idle for 13 hours has lost its place here while its
--    session could still renew itself; it then comes back as a new device and needs a free place. That is
--    the dashboard switch the rollout depends on (plan §6, IA13), recorded rather than discovered. A device
--    that has lost its place and returns needs a free one, even on its own session.
--
--    Two sign-ins at the same instant must not both take the last place: a per-person advisory lock
--    serialises admission.
--
--    A session that owes its second step (the person HAS a factor and the session is not `aal2`, read from
--    `auth.sessions.aal`) takes no place: a stolen password with no phone behind it must not be able to fill
--    the three and lock the real person out of every new device. (An admin past the company's date with NO
--    factor yet is not covered: that person has nothing to give a code from, so the session is their only
--    way to set one up. The rule that refuses it lives in the API, `secondFactorRequired`.)
--
-- 4. ADDRESSES COME FROM SUPABASE, NOT FROM A HEADER. `auth.sessions.ip` is the address Supabase saw when
--    the device signed in or renewed its session; the function reads it itself. An API-side `X-Forwarded-For`
--    would be one more thing a caller could write.
--
-- 5. CHEAP ENOUGH TO RUN IN THE ONE READ. The API calls `member_access_check` instead of 0617's
--    `member_access_state` (the same one round trip per session per 15 s, Q-IA10 (a)). It writes only when
--    something changed: a new device, a new address, or a `last_seen_at` more than five minutes old.
--    `p_limit` null records without limiting — the API's first merge passes null, the merge with the
--    "three devices" screens passes 3, so nobody is stopped before there is a page that explains it.
--
-- `plpgsql`, for 0363's reason: the file must not require `auth.sessions`/`auth.mfa_factors` at CREATE time.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: two new tables nothing reads and one new function nothing calls.
-- 0617's `member_access_state` is untouched.
--
-- Rollback: drop the function and both tables — after the reader's merge is reverted.

-- ── 1. the tables ───────────────────────────────────────────────────────────────────────────
create table if not exists member_devices (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  device_key       text not null check (length(device_key) between 8 and 80),
  user_agent       text,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_session_id  uuid,
  unique (org_id, user_id, device_key)
);
alter table member_devices enable row level security;
create index if not exists member_devices_session_idx on member_devices (last_session_id);
create index if not exists member_devices_last_seen_idx on member_devices (last_seen_at);

create table if not exists member_device_addresses (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  device_id      uuid not null references member_devices(id) on delete cascade,
  ip             inet not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  unique (device_id, ip)
);
alter table member_device_addresses enable row level security;
create index if not exists member_device_addresses_last_seen_idx on member_device_addresses (last_seen_at);

comment on table member_devices is
  'A device a member signed in on, remembered past sign-out (IA-S6). device_key is the app''s own random key, or session:<id> for an app that sends none.';
comment on table member_device_addresses is
  'Every address a remembered device was seen from, read from auth.sessions.ip (IA-S6). Kept 12 months after last seen (Q-IA17).';

-- ── 2. the one read, now with the device ────────────────────────────────────────────────────
create or replace function member_access_check(
  p_org uuid, p_user uuid, p_session uuid, p_device_key text, p_limit integer, p_idle_hours integer
)
returns table (
  role user_role,
  suspended_at timestamptz,
  session_alive boolean,
  second_factor_required_from timestamptz,
  has_second_factor boolean,
  device_admitted boolean,
  devices_in_use integer
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_alive   boolean;
  v_factor  boolean;
  v_aal     text;
  v_ip      inet;
  v_ua      text;
  v_key     text;
  v_device  uuid;
  v_seen    timestamptz;
  v_in_use  integer;
  v_ok      boolean := null;
  v_idle    interval := make_interval(hours => greatest(coalesce(p_idle_hours, 12), 1));
begin
  if not exists (select 1 from public.memberships mb where mb.org_id = p_org and mb.user_id = p_user) then
    return;
  end if;

  if p_session is not null then
    select true, s.ip, s.user_agent, s.aal::text into v_alive, v_ip, v_ua, v_aal
      from auth.sessions s
     where s.id = p_session and s.user_id = p_user and (s.not_after is null or s.not_after > now());
    v_alive := coalesce(v_alive, false);
  end if;

  select exists (
    select 1 from auth.mfa_factors f where f.user_id = p_user and f.status::text = 'verified'
  ) into v_factor;

  -- A device is decided only for a live session: a dead one is refused on its own rule above. And only once
  -- the session has given its second step when the person has a factor: a password alone must not take a
  -- place, or somebody holding a stolen password and no phone could fill all three and stop the real person
  -- signing in anywhere new. Such a session is refused by the second-factor rule anyway; it is admitted,
  -- if there is room, on its first request after the code.
  if v_alive and (not v_factor or v_aal = 'aal2') then
    perform pg_advisory_xact_lock(hashtext('member_devices:' || p_user::text));

    -- (a) this session already holds a device: that is its device, whatever key it sends now.
    select d.id, d.last_seen_at into v_device, v_seen
      from public.member_devices d
     where d.org_id = p_org and d.user_id = p_user and d.last_session_id = p_session;

    -- (b) else the app's own key, when it sent a usable one; else the session itself.
    if v_device is null then
      v_key := case when p_device_key ~ '^[A-Za-z0-9_-]{16,64}$' then 'app:' || p_device_key
                    else 'session:' || p_session::text end;
      select d.id, d.last_seen_at into v_device, v_seen
        from public.member_devices d
       where d.org_id = p_org and d.user_id = p_user and d.device_key = v_key;
    end if;

    -- The devices holding a place now, this one aside: their session still exists AND the API saw them
    -- within the idle window. The clock is OUR `last_seen_at`, not the session's `updated_at` — a device
    -- back after a day renews its session first, so Supabase's clock would call it busy the moment it
    -- returns and let it in over the limit.
    select count(*)::int into v_in_use
      from public.member_devices d
      join auth.sessions s on s.id = d.last_session_id and s.user_id = p_user
     where d.org_id = p_org and d.user_id = p_user
       and (v_device is null or d.id <> v_device)
       and (s.not_after is null or s.not_after > now())
       and d.last_seen_at > now() - v_idle;

    if v_device is not null and v_seen > now() - v_idle and exists (
         select 1 from public.member_devices d where d.id = v_device and d.last_session_id = p_session) then
      v_ok := true;                                   -- it holds its place already
    elsif p_limit is null or v_in_use < p_limit then
      v_ok := true;                                   -- a free place: take it
    else
      v_ok := false;                                  -- the fourth: nothing written
    end if;

    if v_ok then
      if v_device is null then
        insert into public.member_devices (org_id, user_id, device_key, user_agent, last_session_id)
        values (p_org, p_user, v_key, v_ua, p_session)
        returning id into v_device;
      elsif v_seen < now() - interval '5 minutes'
            or not exists (select 1 from public.member_devices d where d.id = v_device and d.last_session_id = p_session) then
        update public.member_devices d
           set last_seen_at = now(), last_session_id = p_session, user_agent = coalesce(v_ua, d.user_agent)
         where d.id = v_device;
      end if;

      if v_ip is not null then
        insert into public.member_device_addresses (org_id, device_id, ip)
        values (p_org, v_device, v_ip)
        on conflict (device_id, ip) do update
          set last_seen_at = now()
          where public.member_device_addresses.last_seen_at < now() - interval '5 minutes';
      end if;
      v_in_use := v_in_use + 1;
    end if;
  end if;

  return query
    select mb.role, mb.suspended_at, v_alive, o.second_factor_required_from, v_factor, v_ok, v_in_use
      from public.memberships mb
      join public.organizations o on o.id = mb.org_id
     where mb.org_id = p_org and mb.user_id = p_user;
end;
$$;

revoke all on function member_access_check(uuid, uuid, uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function member_access_check(uuid, uuid, uuid, text, integer, integer) to service_role;

comment on function member_access_check(uuid, uuid, uuid, text, integer, integer) is
  'requireAuth''s one read (IA-S6): everything member_access_state (0617) answers, plus whether THIS device holds one of p_limit places (null = no limit), admitting and remembering it — and the address Supabase saw — when it may.';

-- ── 3. the devices list, for the panel and the "three devices" page ─────────────────────────
create or replace function member_devices_list(p_org uuid, p_user uuid, p_idle_hours integer)
returns table (
  id uuid, user_agent text, first_seen_at timestamptz, last_seen_at timestamptz,
  session_id uuid, signed_in boolean, addresses jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_idle interval := make_interval(hours => greatest(coalesce(p_idle_hours, 12), 1));
begin
  if not exists (select 1 from public.memberships mb where mb.org_id = p_org and mb.user_id = p_user) then
    return;
  end if;
  return query
    select d.id, d.user_agent, d.first_seen_at, d.last_seen_at,
           case when live.id is not null then d.last_session_id end,
           live.id is not null,
           coalesce((select jsonb_agg(jsonb_build_object('ip', host(a.ip), 'first_seen_at', a.first_seen_at,
                                                         'last_seen_at', a.last_seen_at) order by a.last_seen_at desc)
                       from public.member_device_addresses a where a.device_id = d.id), '[]'::jsonb)
      from public.member_devices d
      left join auth.sessions live
        on live.id = d.last_session_id and live.user_id = p_user
       and (live.not_after is null or live.not_after > now())
       and d.last_seen_at > now() - v_idle
     where d.org_id = p_org and d.user_id = p_user
     order by (live.id is not null) desc, d.last_seen_at desc, d.id;
end;
$$;

revoke all on function member_devices_list(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function member_devices_list(uuid, uuid, integer) to service_role;

comment on function member_devices_list(uuid, uuid, integer) is
  'A member''s remembered devices, signed-in ones first, each with every address it used (IA-S6). Never a token.';
