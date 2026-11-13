-- Silvicom 360 — 0603 office chat on the phone: Do not disturb (CHAT-WEB-PUSH-PLAN WP5; D-WP13, D-WP14; Q-WP4)
--
-- The owner asked on 2026-11-13 for a "do not disturb" option and ruled the proposal: pause for an hour, pause
-- until tomorrow morning, or every night between two times — per PERSON (pausing on the PC also quiets the
-- phone), holding back EVERYTHING including a direct mention, and never replaying what came during the pause
-- (the inbox has it). This file is the schema half; the rail's control and its route are the next merge
-- (a column and its first reader ship in two merges, lint:migration-ordering).
--
-- 1. WHERE IT LIVES. `notification_preferences` (0089) already holds a person's quiet hours and timezone — the
--    "every night" half exists, it only never had a screen (production: 0 rows, 2026-11-13). The manual pause
--    is one new column beside them, `paused_until`.
--
-- 2. ONE WINDOW RULE, NOT TWO (D-WP13). Whether an instant falls inside a person's nightly window — in THEIR
--    timezone, wrapping midnight — was written inline in `notification_allowed` (0089, restated by 0154).
--    It moves into `quiet_window_covers`, which the bell and the phone both call. `notification_allowed`
--    keeps 0154's behaviour exactly: the module question first, then mutes, then critical, then the window.
--
-- 3. THE PAUSE SILENCES; IT NEVER DROPS (D-WP14). The bell's quiet hours SUPPRESS an event — `emit_notification`
--    never inserts it — so routing the pause through `notification_allowed` would lose every bell item that
--    arrived while somebody had paused. The pause is therefore NOT part of the bell's rule: `person_quiet_at`
--    (pause or window) is read only by `chat_push_targets`, and what it holds back is a push, never a line.
--    Whether the bell's own quiet hours should keep dropping events is not changed here (Q-WP6).
--
-- 4. `chat_push_targets` — 0599's body character for character, plus one condition: not somebody quiet at the
--    moment of delivery. The API asks after the 15-second hold (D-WP3), so a line written during a pause is
--    never pushed later; the inbox is where it waits.
--
-- 5. Two writers and one reader, all through functions (an upsert of a partial payload is refused by
--    lint:upserts, and the person must be an active office member — WP001, as 0599).
--
-- WHY THE OLD CODE MEETS THIS SAFELY: one nullable column nothing reads yet; `notification_allowed` answers
-- exactly as before; `chat_push_targets` keeps its signature and shape, and for every person who has set
-- neither a pause nor a window (all of them today) answers exactly as before.
--
-- Rollback: restore 0154's `notification_allowed` and 0599's `chat_push_targets`; drop the four new functions
-- and the column — after the next merge's route and control are reverted.

-- ── 1. The pause ──────────────────────────────────────────────────────────────────────────────────
alter table notification_preferences add column if not exists paused_until timestamptz;

-- ── 2. One window rule ────────────────────────────────────────────────────────────────────────────
-- Does the nightly window [start, end) cover this instant in this timezone? A window that wraps midnight
-- (22:00 → 06:00) is the normal case. No window, or an unknown timezone, covers nothing: "I could not tell"
-- must never silence a person (0089's own reason, from the other side).
create or replace function public.quiet_window_covers(p_start time, p_end time, p_tz text, p_at timestamptz)
returns boolean
language plpgsql stable set search_path = ''
as $$
declare
  v_local time;
begin
  if p_start is null or p_end is null or p_start = p_end then
    return false;
  end if;
  v_local := (p_at at time zone coalesce(p_tz, 'UTC'))::time;
  if p_start < p_end then
    return v_local >= p_start and v_local < p_end;
  end if;
  return v_local >= p_start or v_local < p_end;
exception when others then
  return false;
end;
$$;

-- 0154's body, with the window read through the one rule. Same answers: an unknown timezone was `true`
-- (allowed) there and is "not covered" here, i.e. allowed.
create or replace function public.notification_allowed(
  p_org uuid, p_user uuid, p_category text, p_severity text default 'info', p_at timestamptz default now()
)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare p record;
begin
  if not public.org_module_enabled(p_org, 'notifications') then return false; end if;
  select * into p from public.notification_preferences where user_id = p_user;
  if p is null then return true; end if;
  if p_category = any (p.muted_categories) then return false; end if;
  if p_severity = 'critical' then return true; end if;
  return not public.quiet_window_covers(p.quiet_hours_start, p.quiet_hours_end, p.timezone, p_at);
exception when others then return true;
end;
$$;

-- Is this person not to be buzzed at this instant: paused, or inside their nightly window? Phone only (D-WP14).
create or replace function public.person_quiet_at(p_user uuid, p_at timestamptz)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select (p.paused_until is not null and p.paused_until > p_at)
        or public.quiet_window_covers(p.quiet_hours_start, p.quiet_hours_end, p.timezone, p_at)
      from public.notification_preferences p
     where p.user_id = p_user
  ), false);
$$;

-- ── 3. Who a line is pushed to: 0599, plus "not quiet now" ────────────────────────────────────────
create or replace function chat_push_targets(p_org uuid, p_message uuid, p_mentioned uuid[])
returns table (user_id uuid, reason text)
language sql stable security definer set search_path = ''
as $$
  with m as (
    select x.id, x.thread_id, x.seq, x.sender_user_id, t.kind
      from public.messages x
      join public.message_threads t on t.id = x.thread_id and t.org_id = p_org
     where x.id = p_message and x.org_id = p_org and x.deleted_at is null and x.sender_user_id is not null
       and t.kind in ('direct', 'group', 'channel')
  ),
  named as (
    select n.user_id, case n.category when 'chat_mention' then 'mention' else 'reply' end as reason
      from public.chat_notify_targets(p_org, p_message) n
  ),
  lines as (
    select p.user_id, 'line'::text as reason
      from m join public.thread_participants p on p.thread_id = m.thread_id
     where m.kind in ('direct', 'group') and p.left_at is null and p.muted = 'none'
  ),
  wanted as (
    select w.user_id, w.reason from named w
     where p_mentioned is null or (w.reason = 'mention' and w.user_id = any (p_mentioned))
    union all
    select l.user_id, l.reason from lines l where p_mentioned is null
  ),
  one as (
    select distinct on (w.user_id) w.user_id, w.reason
      from wanted w
     order by w.user_id, case w.reason when 'mention' then 0 when 'reply' then 1 else 2 end
  )
  select o.user_id, o.reason
    from one o
    cross join m
    join public.thread_participants p on p.thread_id = m.thread_id and p.user_id = o.user_id and p.left_at is null
    join public.memberships mb on mb.org_id = p_org and mb.user_id = o.user_id
                              and mb.suspended_at is null and mb.role <> 'driver'
   where o.user_id <> m.sender_user_id
     and not public.person_quiet_at(o.user_id, now())
     and case
           when p_mentioned is null then p.read_seq < m.seq
           else coalesce((select s.activity_read_at from public.chat_person_state s
                           where s.org_id = p_org and s.user_id = o.user_id), '-infinity'::timestamptz)
                < (select mm.created_at from public.message_mentions mm
                    where mm.message_id = m.id and mm.user_id = o.user_id)
         end
   order by o.user_id;
$$;

-- ── 4. Read and set (the rail's control, next merge) ──────────────────────────────────────────────
-- The person's Do not disturb as the control shows it, and whether it holds right now.
create or replace function chat_dnd_state(p_org uuid, p_user uuid)
returns table (paused_until timestamptz, quiet_hours_start time, quiet_hours_end time, timezone text, quiet_now boolean)
language sql stable security definer set search_path = ''
as $$
  select p.paused_until, p.quiet_hours_start, p.quiet_hours_end, coalesce(p.timezone, 'UTC'),
         public.person_quiet_at(p_user, now())
    from (select 1) one
    left join public.notification_preferences p on p.user_id = p_user
   where exists (select 1 from public.memberships mb
                  where mb.org_id = p_org and mb.user_id = p_user and mb.suspended_at is null and mb.role <> 'driver');
$$;

-- Pause until an instant (null = resume now). A pause in the past is a resume; one beyond a week is refused —
-- a pause is for an hour or a night, and a forgotten year-long pause is a person who silently hears nothing.
create or replace function chat_dnd_pause(p_org uuid, p_user uuid, p_until timestamptz)
returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_until timestamptz := case when p_until is not null and p_until > now() then p_until end;
begin
  if not exists (select 1 from public.memberships mb
                  where mb.org_id = p_org and mb.user_id = p_user and mb.suspended_at is null and mb.role <> 'driver') then
    raise exception 'not an active office member of this organisation' using errcode = 'WP001';
  end if;
  if v_until is not null and v_until > now() + interval '7 days' then
    raise exception 'a pause is at most seven days' using errcode = '22023';
  end if;
  insert into public.notification_preferences as p (user_id, org_id, paused_until, updated_at)
  values (p_user, p_org, v_until, now())
  on conflict (user_id) do update set paused_until = excluded.paused_until, updated_at = now();
  return v_until;
end;
$$;

-- The nightly window, in the person's timezone (both times null = no window). Writes the same three columns
-- the bell reads, so a window set here quiets the bell's non-critical alerts too — as it always has.
create or replace function chat_dnd_schedule(p_org uuid, p_user uuid, p_start time, p_end time, p_tz text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.memberships mb
                  where mb.org_id = p_org and mb.user_id = p_user and mb.suspended_at is null and mb.role <> 'driver') then
    raise exception 'not an active office member of this organisation' using errcode = 'WP001';
  end if;
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_start = p_end) then
    raise exception 'a window needs a start and a different end, or neither' using errcode = '22023';
  end if;
  if p_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz) then
    raise exception 'unknown timezone' using errcode = '22023';
  end if;
  insert into public.notification_preferences as p (user_id, org_id, quiet_hours_start, quiet_hours_end, timezone, updated_at)
  values (p_user, p_org, p_start, p_end, p_tz, now())
  on conflict (user_id) do update
     set quiet_hours_start = excluded.quiet_hours_start, quiet_hours_end = excluded.quiet_hours_end,
         timezone = excluded.timezone, updated_at = now();
end;
$$;

-- ── Grants: service role only ─────────────────────────────────────────────────────────────────────
revoke all on function public.quiet_window_covers(time, time, text, timestamptz) from public, anon, authenticated;
revoke all on function public.person_quiet_at(uuid, timestamptz) from public, anon, authenticated;
revoke all on function chat_push_targets(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function chat_dnd_state(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_dnd_pause(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function chat_dnd_schedule(uuid, uuid, time, time, text) from public, anon, authenticated;
grant execute on function public.quiet_window_covers(time, time, text, timestamptz) to service_role;
grant execute on function public.person_quiet_at(uuid, timestamptz) to service_role;
grant execute on function chat_push_targets(uuid, uuid, uuid[]) to service_role;
grant execute on function chat_dnd_state(uuid, uuid) to service_role;
grant execute on function chat_dnd_pause(uuid, uuid, timestamptz) to service_role;
grant execute on function chat_dnd_schedule(uuid, uuid, time, time, text) to service_role;
