-- Silvicom 360 — 0662 two-step sign-in by an emailed code, remembered on a device for seven days
-- (INSTALLED-APP-PLAN IA-S1 rev 2; the owner's ruling of 2026-11-27, Q-IA20)
--
-- The owner, 2026-11-27: the authenticator-app sign-in "is too complicated and not really what we want". Ruled
-- instead: a 6-digit code SENT BY EMAIL to the person's sign-in address, asked again after ONE WEEK. That
-- supersedes Q-IA1 (b) (required for admins only, authenticator app), Q-IA11 (who removes a lost phone — there is
-- no phone to lose), Q-IA12 (the 14-day notice — there is nothing to set up), and Q-IA18's "never (c)": a device
-- that gave its code now skips it for seven days, which is exactly what "after 1 week" asks.
--
-- 1. WHY EMAIL IS NOT A WEAKER FLOOR THAN WHAT WE HAD. Whoever reads the person's mailbox can already take the
--    account: the password reset (0363) mails a link there. So a code sent to the same mailbox adds the one thing
--    a second step is for — a stolen PASSWORD alone no longer opens a session — and removes nothing.
--
-- 2. WHO. Every office role. Not written here: the API passes `p_two_step_required` from `isRosterIssuedRole` in
--    `@silvicom/shared` (drivers sign in to the driver app with a company-issued password and are not asked), so
--    the role rule has one home, as 0617 kept `isAdmin` out of SQL for the same reason.
--
-- 3. A DEVICE, NOT A SESSION, IS WHAT IS TRUSTED FOR A WEEK. Sessions end at the 12-hour idle sign-out (Q-IA2) and
--    at every sign-out, so "ask again after a week" per SESSION would ask nearly every morning. The device is
--    0620's: the app's own random key (`p_device_key`), or `session:<id>` for an app that sends none — the same
--    rule as `member_access_check`, in one helper both new functions call. A key names nothing and proves nothing
--    by itself; it is a random value only that browser holds, the same standing as a "remember this device"
--    cookie, and a stolen password on any OTHER device still meets the code.
--
-- 4. THE CODE. Six digits, ten minutes, one live code per device (a new one revokes the old), five wrong entries
--    and it is dead, five sent per person per hour, no second email within 60 seconds of the first (a page reload
--    must not mail again). Stored as an HMAC the API computes with a key the database never holds, so a copy of
--    this table cannot be turned back into codes by trying all million. Entering it is ONE function holding a
--    per-person lock, so two tabs cannot each get five guesses at one code.
--
-- 5. THE ONE READ, AGAIN. `member_access_gate` answers what 0620's `member_access_check` answers, minus the
--    authenticator facts, plus `two_step_at`: when THIS device last gave its code. Device admission (the three
--    places, Q-IA14) is decided only once the second step is satisfied or not required — 0620's protection, kept:
--    a stolen password with no mailbox behind it cannot fill the three places.
--
-- 6. WHAT IS LEFT BEHIND. `organizations.second_factor_required_from` (0617) and the functions `member_access_state`
--    (0617) and `member_access_check` (0620) lose their reader with the API merge that reads this file; each is
--    dropped a release after that. `auth.mfa_factors` is Supabase's and untouched: the platform console keeps
--    its authenticator app (`apps/admin`), which this ruling did not reach.
--
-- `plpgsql`, for 0363's reason: the file must not require `auth.sessions` at CREATE time.
--
-- WHY THE OLD CODE MEETS THIS SAFELY: two new tables nothing reads and four new functions nothing calls. No
-- existing function, policy or column is changed.
--
-- Rollback: drop the four functions and both tables — after the reader's merge is reverted.

-- ── 1. the tables ───────────────────────────────────────────────────────────────────────────
create table if not exists two_step_codes (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  device_key  text not null check (length(device_key) between 8 and 80),
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  attempts    smallint not null default 0 check (attempts >= 0),
  used_at     timestamptz,
  revoked_at  timestamptz
);
alter table two_step_codes enable row level security;
create index if not exists two_step_codes_user_created_idx on two_step_codes (user_id, created_at);
create index if not exists two_step_codes_created_idx on two_step_codes (created_at);
-- One live code per device: `two_step_code_issue` revokes the previous one before inserting, under its lock.
create unique index if not exists two_step_codes_one_live
  on two_step_codes (org_id, user_id, device_key) where used_at is null and revoked_at is null;

create table if not exists two_step_devices (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  device_key       text not null check (length(device_key) between 8 and 80),
  verified_at      timestamptz not null default now(),
  last_session_id  uuid,
  unique (org_id, user_id, device_key)
);
alter table two_step_devices enable row level security;
create index if not exists two_step_devices_verified_idx on two_step_devices (verified_at);

comment on table two_step_codes is
  'Emailed 6-digit sign-in codes (IA-S1 rev 2, Q-IA20). code_hash is an HMAC the API keys; the code itself is never stored.';
comment on table two_step_devices is
  'When a device last gave its emailed sign-in code (IA-S1 rev 2, Q-IA20). Trusted for the API''s TWO_STEP_DAYS after verified_at.';

-- ── 2. which device — one rule for every function below ─────────────────────────────────────
create or replace function two_step_device_key(p_device_key text, p_session uuid)
returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_device_key ~ '^[A-Za-z0-9_-]{16,64}$' then 'app:' || p_device_key
    when p_session is not null then 'session:' || p_session::text
  end;
$$;
revoke all on function two_step_device_key(text, uuid) from public, anon, authenticated;
grant execute on function two_step_device_key(text, uuid) to service_role;

-- ── 3. the one read ─────────────────────────────────────────────────────────────────────────
create or replace function member_access_gate(
  p_org uuid, p_user uuid, p_session uuid, p_device_key text, p_limit integer, p_idle_hours integer,
  p_two_step_days integer, p_two_step_required boolean
)
returns table (
  role user_role,
  suspended_at timestamptz,
  session_alive boolean,
  two_step_at timestamptz,
  device_admitted boolean,
  devices_in_use integer
)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_alive     boolean;
  v_ip        inet;
  v_ua        text;
  v_key       text;
  v_step_key  text := public.two_step_device_key(p_device_key, p_session);
  v_step_at   timestamptz;
  v_device    uuid;
  v_seen      timestamptz;
  v_in_use    integer;
  v_ok        boolean := null;
  v_idle      interval := make_interval(hours => greatest(coalesce(p_idle_hours, 12), 1));
  v_week      interval := make_interval(days => greatest(coalesce(p_two_step_days, 7), 1));
begin
  if not exists (select 1 from public.memberships mb where mb.org_id = p_org and mb.user_id = p_user) then
    return;
  end if;

  if p_session is not null then
    select true, s.ip, s.user_agent into v_alive, v_ip, v_ua
      from auth.sessions s
     where s.id = p_session and s.user_id = p_user and (s.not_after is null or s.not_after > now());
    v_alive := coalesce(v_alive, false);
  end if;

  if v_step_key is not null then
    select t.verified_at into v_step_at
      from public.two_step_devices t
     where t.org_id = p_org and t.user_id = p_user and t.device_key = v_step_key;
  end if;

  -- 0620's device places, decided only once the second step is satisfied or not owed (header §5).
  if v_alive and (not coalesce(p_two_step_required, true) or v_step_at > now() - v_week) then
    perform pg_advisory_xact_lock(hashtext('member_devices:' || p_user::text));

    select d.id, d.last_seen_at into v_device, v_seen
      from public.member_devices d
     where d.org_id = p_org and d.user_id = p_user and d.last_session_id = p_session;

    if v_device is null then
      v_key := case when p_device_key ~ '^[A-Za-z0-9_-]{16,64}$' then 'app:' || p_device_key
                    else 'session:' || p_session::text end;
      select d.id, d.last_seen_at into v_device, v_seen
        from public.member_devices d
       where d.org_id = p_org and d.user_id = p_user and d.device_key = v_key;
    end if;

    select count(*)::int into v_in_use
      from public.member_devices d
      join auth.sessions s on s.id = d.last_session_id and s.user_id = p_user
     where d.org_id = p_org and d.user_id = p_user
       and (v_device is null or d.id <> v_device)
       and (s.not_after is null or s.not_after > now())
       and d.last_seen_at > now() - v_idle;

    if v_device is not null and v_seen > now() - v_idle and exists (
         select 1 from public.member_devices d where d.id = v_device and d.last_session_id = p_session) then
      v_ok := true;
    elsif p_limit is null or v_in_use < p_limit then
      v_ok := true;
    else
      v_ok := false;
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
    select mb.role, mb.suspended_at, v_alive, v_step_at, v_ok, v_in_use
      from public.memberships mb
     where mb.org_id = p_org and mb.user_id = p_user;
end;
$$;

revoke all on function member_access_gate(uuid, uuid, uuid, text, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function member_access_gate(uuid, uuid, uuid, text, integer, integer, integer, boolean) to service_role;
comment on function member_access_gate(uuid, uuid, uuid, text, integer, integer, integer, boolean) is
  'requireAuth''s one read (IA-S1 rev 2): membership, session, when this device last gave its emailed code, and 0620''s device places — admitted only once the code is not owed.';

-- ── 4. sending a code ───────────────────────────────────────────────────────────────────────
-- issued   a new code row exists; the API mails it (and calls `two_step_code_revoke` if the mail fails)
-- recent   a code went to this device less than p_resend_seconds ago: nothing new, the same expiry answered
-- throttled  p_max_per_hour codes were made for this person in the last hour
-- no_device  neither a usable key nor a session — nothing to remember the answer against
create or replace function two_step_code_issue(
  p_org uuid, p_user uuid, p_session uuid, p_device_key text, p_code_hash text,
  p_ttl_minutes integer, p_max_per_hour integer, p_resend_seconds integer
)
returns table (outcome text, code_id uuid, expires_at timestamptz)
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_key     text := public.two_step_device_key(p_device_key, p_session);
  v_recent  public.two_step_codes%rowtype;
  v_count   integer;
  v_id      uuid;
  v_exp     timestamptz;
begin
  if not exists (select 1 from public.memberships mb where mb.org_id = p_org and mb.user_id = p_user) then
    return;
  end if;
  if v_key is null then
    return query select 'no_device'::text, null::uuid, null::timestamptz;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('two_step:' || p_user::text));

  select * into v_recent from public.two_step_codes c
   where c.org_id = p_org and c.user_id = p_user and c.device_key = v_key
     and c.used_at is null and c.revoked_at is null and c.expires_at > now()
     and c.created_at > now() - make_interval(secs => greatest(coalesce(p_resend_seconds, 60), 0))
   order by c.created_at desc limit 1;
  if found then
    return query select 'recent'::text, v_recent.id, v_recent.expires_at;
    return;
  end if;

  select count(*)::int into v_count from public.two_step_codes c
   where c.user_id = p_user and c.created_at > now() - interval '1 hour';
  if v_count >= greatest(coalesce(p_max_per_hour, 5), 1) then
    return query select 'throttled'::text, null::uuid, null::timestamptz;
    return;
  end if;

  update public.two_step_codes c set revoked_at = now()
   where c.org_id = p_org and c.user_id = p_user and c.device_key = v_key
     and c.used_at is null and c.revoked_at is null;

  v_exp := now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 10), 1));
  insert into public.two_step_codes (org_id, user_id, device_key, code_hash, expires_at)
  values (p_org, p_user, v_key, p_code_hash, v_exp)
  returning id into v_id;
  return query select 'issued'::text, v_id, v_exp;
end;
$$;
revoke all on function two_step_code_issue(uuid, uuid, uuid, text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function two_step_code_issue(uuid, uuid, uuid, text, text, integer, integer, integer) to service_role;

-- A code whose email was refused must not stay live: nobody holds it, and a live row would read as "sent".
create or replace function two_step_code_revoke(p_org uuid, p_user uuid, p_code uuid)
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.two_step_codes c set revoked_at = now()
   where c.id = p_code and c.org_id = p_org and c.user_id = p_user and c.used_at is null and c.revoked_at is null;
$$;
revoke all on function two_step_code_revoke(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function two_step_code_revoke(uuid, uuid, uuid) to service_role;

-- ── 5. entering a code ──────────────────────────────────────────────────────────────────────
-- ok        right code: spent, and this device is trusted from now (two_step_devices.verified_at)
-- wrong     not the code; tries remain
-- too_many  this entry used the last try, or none were left: the code is dead, a new one must be sent
-- expired   no live code for this device (never sent, expired, revoked, or already used)
create or replace function two_step_code_verify(
  p_org uuid, p_user uuid, p_session uuid, p_device_key text, p_code_hash text, p_max_attempts integer
)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_key   text := public.two_step_device_key(p_device_key, p_session);
  v_code  public.two_step_codes%rowtype;
  v_max   integer := greatest(coalesce(p_max_attempts, 5), 1);
begin
  if v_key is null or not exists (
       select 1 from public.memberships mb where mb.org_id = p_org and mb.user_id = p_user) then
    return 'expired';
  end if;
  perform pg_advisory_xact_lock(hashtext('two_step:' || p_user::text));

  select * into v_code from public.two_step_codes c
   where c.org_id = p_org and c.user_id = p_user and c.device_key = v_key
     and c.used_at is null and c.revoked_at is null
   order by c.created_at desc limit 1;
  if not found or v_code.expires_at <= now() then
    return 'expired';
  end if;
  if v_code.attempts >= v_max then
    update public.two_step_codes c set revoked_at = now() where c.id = v_code.id;
    return 'too_many';
  end if;

  if v_code.code_hash = p_code_hash then
    update public.two_step_codes c set used_at = now(), attempts = v_code.attempts + 1 where c.id = v_code.id;
    insert into public.two_step_devices (org_id, user_id, device_key, verified_at, last_session_id)
    values (p_org, p_user, v_key, now(), p_session)
    on conflict (org_id, user_id, device_key) do update
      set verified_at = excluded.verified_at, last_session_id = excluded.last_session_id;
    return 'ok';
  end if;

  update public.two_step_codes c
     set attempts = v_code.attempts + 1,
         revoked_at = case when v_code.attempts + 1 >= v_max then now() end
   where c.id = v_code.id;
  return case when v_code.attempts + 1 >= v_max then 'too_many' else 'wrong' end;
end;
$$;
revoke all on function two_step_code_verify(uuid, uuid, uuid, text, text, integer) from public, anon, authenticated;
grant execute on function two_step_code_verify(uuid, uuid, uuid, text, text, integer) to service_role;
