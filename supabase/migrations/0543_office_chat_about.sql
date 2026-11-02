-- Silvicom 360 — 0543 office chat: conversations about a load, a driver or a truck
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH11a, §9.4; D-CHAT31–D-CHAT34, Q-CHAT6 (a))
--
-- "Chat about this": a dispatcher on load L-20481's page, a safety manager on a driver's, a shop lead on
-- a truck's, starts a conversation ABOUT that record and finds it again from the record. This file is
-- the link and the three functions; the API, the chat header and the record pages are CH11b–c, later
-- merges, so no reader runs ahead of its schema.
--
--   1. THE LINK (D-CHAT31). `message_threads.load_id` has existed since 0096 (a driver conversation's
--      load) and is already in the ledger's `conversation_created` detail; `driver_id` and `vehicle_id`
--      join it. At most one of the three, and only a GROUP carries one: a direct conversation is between
--      two people and a channel belongs to its team. Measured before this file: production holds two
--      office conversations, both direct, neither with a load, so the CHECK validates in place. Plain
--      single-column FKs, `on delete set null` like 0096's; the organisation is checked by a trigger, not
--      a composite FK, because a second FK between the same tables makes every PostgREST embed between
--      them ambiguous (PGRST201 — the Odometer page, 2026-10-20). Nothing changes a link once made: no
--      function writes one after `chat_create_about`, except a driver merge re-pointing it to the
--      surviving driver (`DRIVER_REASSIGNMENTS`), which the same trigger checks.
--   2. PARTICIPANTS ONLY (D-CHAT32, Q-CHAT6 (a)). `chat_about` lists the conversations about a record
--      that the CALLER is in now — nothing of the others, not even how many there are. Seeing a record
--      never grants its conversations; bringing somebody in is a participant's Add people (0512).
--   3. WHAT IT IS ABOUT, FOR THE HEADER (D-CHAT34). `chat_thread_about` answers a member with the
--      record's kind, id and what to call it: the load's `ref`, the driver's `full_name`, the truck's
--      `unit_number`. A new function rather than a column on `chat_inbox`, so no existing reader's shape
--      changes.
--   Whether the caller may see the RECORD is the API's to decide, by that record's own section gate,
--   before any of this is asked (D-CHAT33); the database decides the organisation and the membership.
--
-- Error codes, beside 0512's to 0540's (the API maps them in chat.ts):
--   CH016  the record is not in this organisation, or is not a load, a driver or a truck (→ 404)
--
-- WHY THE OLD CODE MEETS THIS SAFELY: two nullable columns no reader selects, a CHECK every row meets,
-- a trigger that only reads, three new functions, and the ledger's detail gaining two keys on new rows.
-- `chat_create_group` and every reader are unchanged.
--
-- Rollback: drop the three functions, the trigger and its function, the CHECK and the two columns;
-- restore 0518's `chat_ledger_threads`. CH11b's routes call the functions and must be reverted first.

-- ── 1. The link ─────────────────────────────────────────────────────────────────────────────────

alter table message_threads add column if not exists driver_id uuid references drivers(id) on delete set null;
alter table message_threads add column if not exists vehicle_id uuid references vehicles(id) on delete set null;

alter table message_threads drop constraint if exists message_threads_about_check;
alter table message_threads add constraint message_threads_about_check check (
  num_nonnulls(load_id, driver_id, vehicle_id) <= 1
  and (kind not in ('direct', 'channel') or num_nonnulls(load_id, driver_id, vehicle_id) = 0)
);

create index if not exists idx_threads_driver on message_threads (driver_id) where driver_id is not null;
create index if not exists idx_threads_vehicle on message_threads (vehicle_id) where vehicle_id is not null;

-- The record a conversation is about must be its organisation's — on insert, and when a driver merge
-- re-points it.
create or replace function message_threads_about_same_org() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (new.load_id is not null and not exists (select 1 from public.loads x where x.id = new.load_id and x.org_id = new.org_id))
     or (new.driver_id is not null and not exists (select 1 from public.drivers x where x.id = new.driver_id and x.org_id = new.org_id))
     or (new.vehicle_id is not null and not exists (select 1 from public.vehicles x where x.id = new.vehicle_id and x.org_id = new.org_id)) then
    raise exception 'that record is not in this organisation' using errcode = 'CH016';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_message_threads_about_same_org on message_threads;
create trigger trg_message_threads_about_same_org before insert or update of load_id, driver_id, vehicle_id, org_id on message_threads
  for each row execute function message_threads_about_same_org();

-- The ledger's `conversation_created` names the record (0518's function, two keys added).
create or replace function chat_ledger_threads() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'conversation_created';
  elsif new.archived_at is not null and old.archived_at is null then
    v_action := 'conversation_archived';
  elsif new.archived_at is null and old.archived_at is not null then
    v_action := 'conversation_restored';
  elsif new.subject is distinct from old.subject then
    v_action := 'conversation_renamed';
  else
    return null;
  end if;
  insert into public.chat_ledger (org_id, actor_user_id, action, thread_id, detail)
  values (new.org_id, coalesce(public.chat_declared_actor(), new.created_by), v_action, new.id,
          jsonb_build_object('kind', new.kind, 'subject', new.subject, 'load_id', new.load_id)
          || case when new.driver_id is not null or new.vehicle_id is not null
                  then jsonb_build_object('driver_id', new.driver_id, 'vehicle_id', new.vehicle_id)
                  else '{}'::jsonb end
          || case when new.kind = 'channel'
                  then jsonb_build_object('space_id', new.space_id, 'visibility', new.visibility, 'general', new.general)
                  else '{}'::jsonb end);
  return null;
end;
$$;

-- ── 2. Functions ────────────────────────────────────────────────────────────────────────────────

-- A group about one record: 0512's `chat_create_group` with the link written in the same insert, so the
-- ledger's `conversation_created` names the record. Retrying with the same id returns it, as there.
create or replace function chat_create_about(
  p_org uuid, p_actor uuid, p_thread_id uuid, p_subject text, p_members uuid[], p_kind text, p_record uuid
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.message_threads;
  v_members uuid[];
  v_user uuid;
begin
  if p_kind is null or p_kind not in ('load', 'driver', 'vehicle') or p_record is null then
    raise exception 'a conversation is about a load, a driver or a truck' using errcode = 'CH016';
  end if;
  select t.* into v_existing from public.message_threads t where t.id = p_thread_id;
  if v_existing.id is not null then
    if v_existing.org_id = p_org and v_existing.kind = 'group' and v_existing.created_by = p_actor then
      return v_existing.id;
    end if;
    raise exception 'that id already belongs to another conversation' using errcode = 'CH007';
  end if;

  select array_agg(distinct u) into v_members from unnest(coalesce(p_members, '{}') || p_actor) u where u is not null;
  if cardinality(v_members) < 2 then
    raise exception 'a group needs at least one other person' using errcode = 'CH002';
  end if;
  if cardinality(v_members) > 250 then
    raise exception 'a group holds at most 250 people; use a channel' using errcode = 'CH006';
  end if;
  foreach v_user in array v_members loop
    perform public.chat_assert_office_member(p_org, v_user);
  end loop;
  perform set_config('silvicom.chat_actor', p_actor::text, true);

  insert into public.message_threads (id, org_id, kind, subject, created_by, load_id, driver_id, vehicle_id)
  values (p_thread_id, p_org, 'group', nullif(btrim(p_subject), ''), p_actor,
          case when p_kind = 'load' then p_record end,
          case when p_kind = 'driver' then p_record end,
          case when p_kind = 'vehicle' then p_record end);
  insert into public.thread_participants (thread_id, org_id, user_id, role, member_role)
  select p_thread_id, p_org, u, 'office', case when u = p_actor then 'owner' else 'member' end
    from unnest(v_members) u;
  return p_thread_id;
end;
$$;

-- The conversations about one record that `p_user` is in now, newest activity first (D-CHAT32). A record
-- of another organisation, or of a kind there is no such thing as, is simply none.
create or replace function chat_about(p_org uuid, p_user uuid, p_kind text, p_record uuid)
returns table (
  thread_id uuid, subject text, created_at timestamptz, last_message_at timestamptz,
  unread bigint, member_count bigint, title_members jsonb
)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.subject, t.created_at, t.last_message_at, greatest(t.last_seq - p.read_seq, 0),
         (select count(*) from public.thread_participants o where o.thread_id = t.id and o.left_at is null),
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', public.chat_display_name(p_org, o.user_id))
                            order by o.joined_at, o.user_id)
             from (select o2.user_id, o2.joined_at from public.thread_participants o2
                    where o2.thread_id = t.id and o2.left_at is null and o2.user_id <> p_user
                    order by o2.joined_at, o2.user_id limit 4) o
         ), '[]'::jsonb)
    from public.message_threads t
    join public.thread_participants p on p.thread_id = t.id and p.user_id = p_user and p.left_at is null
   where t.org_id = p_org and t.kind = 'group'
     and case p_kind when 'load' then t.load_id = p_record
                     when 'driver' then t.driver_id = p_record
                     when 'vehicle' then t.vehicle_id = p_record
                     else false end
   order by t.last_message_at desc, t.id desc
   limit 50;
$$;

-- What one conversation is about, for its header (D-CHAT34): no row when it is about nothing. Asked by
-- a member only (CH001 otherwise, as every chat reader).
create or replace function chat_thread_about(p_org uuid, p_user uuid, p_thread uuid)
returns table (kind text, record_id uuid, label text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.message_threads;
begin
  v := public.chat_member_thread(p_org, p_user, p_thread);
  if v.kind <> 'group' then
    return;
  end if;
  return query
    select 'load'::text, l.id, l.ref from public.loads l where l.id = v.load_id and l.org_id = p_org
    union all
    select 'driver', d.id, d.full_name from public.drivers d where d.id = v.driver_id and d.org_id = p_org
    union all
    select 'vehicle', x.id, x.unit_number from public.vehicles x where x.id = v.vehicle_id and x.org_id = p_org;
end;
$$;

revoke all on function message_threads_about_same_org() from public, anon, authenticated;
revoke all on function chat_ledger_threads() from public, anon, authenticated;
revoke all on function chat_create_about(uuid, uuid, uuid, text, uuid[], text, uuid) from public, anon, authenticated;
revoke all on function chat_about(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function chat_thread_about(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function chat_create_about(uuid, uuid, uuid, text, uuid[], text, uuid) to service_role;
grant execute on function chat_about(uuid, uuid, text, uuid) to service_role;
grant execute on function chat_thread_about(uuid, uuid, uuid) to service_role;
