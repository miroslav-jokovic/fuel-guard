-- Silvicom 360 — 0512 office chat: the functions the API reads and writes through
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH1a; D-CHAT4, D-CHAT5, D-CHAT12)
--
-- Every function here is SERVICE-ROLE ONLY. Each takes the org and the acting user as arguments because
-- the API has already authenticated them (requireAuth/requireOrg) — so a browser that could call one
-- could name anybody, which is why EXECUTE is revoked from anon and authenticated below.
--
-- WHY FUNCTIONS AND NOT POSTGREST READS: 0096's `listThreads` read every message of every thread to
-- compute unread and the last line in JavaScript, and PostgREST caps a response at 1,000 rows without
-- saying so. The inbox here is one keyset-paged query on `last_seq − read_seq`; history and sync page by
-- `seq` and `rev`. WHY THE WRITES ARE FUNCTIONS: a conversation, its members and its ledger rows land in
-- one transaction, and the participant rules (D-CHAT4) are checked where the rows are written.
--
-- THE PARTICIPANT RULE (D-CHAT4), stated once in `chat_assert_office_member`: a person named into an
-- office conversation holds a membership of THIS org that is not suspended and is not `driver`. 0096's
-- driver threads keep their server-resolved audience (`messages.ts`), untouched.
--
-- Error codes (the API maps each to an HTTP answer in CH1b):
--   CH001  not in that conversation (→ 404: do not confirm it exists)
--   CH002  that person cannot be in an office conversation
--   CH003  a message's conversation, author, time or position cannot change (0511)
--   CH004  a retracted message cannot be edited or restored (0511)
--   CH005  the conversation is archived
--   CH006  not allowed for this kind of conversation, or only the author may do that
--   CH007  that id already belongs to something else (a client UUID reused)
--   CH008  only an owner of the conversation may do that
--
-- Rollback: drop the functions below. CH1b's routes call them and must be reverted first.

-- ── Names ───────────────────────────────────────────────────────────────────────────────────────
-- D-MEM3's order (0301): what the person typed, then the roster's name, then the address's local part
-- so a row never reads "null".
create or replace function chat_display_name(p_org uuid, p_user uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select up.full_name from public.user_profiles up where up.user_id = p_user),
    (select d.full_name from public.drivers d where d.user_id = p_user and d.org_id = p_org limit 1),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user)
  );
$$;

-- ── Rules ───────────────────────────────────────────────────────────────────────────────────────
create or replace function chat_assert_office_member(p_org uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memberships m
     where m.org_id = p_org and m.user_id = p_user and m.suspended_at is null and m.role <> 'driver'
  ) then
    raise exception 'that person cannot be in an office conversation' using errcode = 'CH002';
  end if;
end;
$$;

-- The conversation, if the user is in it now; CH001 otherwise.
create or replace function chat_member_thread(p_org uuid, p_user uuid, p_thread uuid)
returns public.message_threads
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.message_threads;
begin
  select t.* into v from public.message_threads t
   where t.id = p_thread and t.org_id = p_org
     and exists (select 1 from public.thread_participants p
                  where p.thread_id = t.id and p.user_id = p_user and p.left_at is null);
  if v.id is null then
    raise exception 'not in that conversation' using errcode = 'CH001';
  end if;
  return v;
end;
$$;

-- ── Reads ───────────────────────────────────────────────────────────────────────────────────────

-- Who can be named into an office conversation: the people picker's list, from the same rule
-- `chat_assert_office_member` enforces, so the picker cannot offer somebody the write would refuse.
create or replace function chat_people(p_org uuid)
returns table (user_id uuid, name text, role text)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, public.chat_display_name(p_org, m.user_id), m.role::text
    from public.memberships m
   where m.org_id = p_org and m.suspended_at is null and m.role <> 'driver'
   order by 2, 1;
$$;

-- The inbox, newest first, keyset-paged on (last_message_at, id). `title_members` is up to four other
-- people for the row's title; the full list is chat_members(). `p_thread` narrows it to one
-- conversation, so the conversation header and the inbox row are one shape from one query.
create or replace function chat_inbox(
  p_org uuid, p_user uuid, p_kinds text[], p_before_at timestamptz, p_before_id uuid, p_limit integer,
  p_thread uuid default null
) returns table (
  thread_id uuid, kind text, subject text, load_id uuid, created_at timestamptz,
  last_message_at timestamptz, last_seq bigint, rev bigint, read_seq bigint, unread bigint,
  muted text, member_role text, member_count bigint, title_members jsonb, last_message jsonb
)
language sql stable security definer set search_path = ''
as $$
  select t.id, t.kind, t.subject, t.load_id, t.created_at, t.last_message_at, t.last_seq, t.rev,
         p.read_seq, greatest(t.last_seq - p.read_seq, 0), p.muted, p.member_role,
         (select count(*) from public.thread_participants o where o.thread_id = t.id and o.left_at is null),
         coalesce((
           select jsonb_agg(jsonb_build_object('user_id', o.user_id, 'name', public.chat_display_name(p_org, o.user_id))
                            order by o.joined_at, o.user_id)
             from (select o2.user_id, o2.joined_at from public.thread_participants o2
                    where o2.thread_id = t.id and o2.left_at is null and o2.user_id <> p_user
                    order by o2.joined_at, o2.user_id limit 4) o
         ), '[]'::jsonb),
         (select jsonb_build_object(
                   'id', m.id, 'seq', m.seq, 'sender_user_id', m.sender_user_id,
                   'sender_name', public.chat_display_name(p_org, m.sender_user_id),
                   'body', case when m.deleted_at is null then m.body end,
                   'created_at', m.created_at, 'deleted', m.deleted_at is not null)
            from public.messages m where m.thread_id = t.id and m.seq = t.last_seq)
    from public.thread_participants p
    join public.message_threads t on t.id = p.thread_id and t.org_id = p_org
   where p.user_id = p_user and p.org_id = p_org and p.left_at is null
     and t.kind = any (p_kinds)
     and (p_thread is null or t.id = p_thread)
     and (p_before_at is null or (t.last_message_at, t.id) < (p_before_at, p_before_id))
   order by t.last_message_at desc, t.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- One page of a conversation, newest first, before `p_before_seq` (null = from the end). A retracted
-- message keeps its place with a null body (`messageBody()` renders "Message removed").
create or replace function chat_history(p_org uuid, p_user uuid, p_thread uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- Everything that changed after `p_since_rev`, oldest change first: new messages, edits, retractions.
-- A client that got a realtime signal (CH3) or reconnected calls this with the last rev it holds.
create or replace function chat_sync(p_org uuid, p_user uuid, p_thread uuid, p_since_rev bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org and m.rev > coalesce(p_since_rev, 0)
     order by m.rev
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

create or replace function chat_members(p_org uuid, p_user uuid, p_thread uuid)
returns table (
  user_id uuid, name text, role text, member_role text, read_seq bigint, last_read_at timestamptz,
  joined_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select p.user_id, public.chat_display_name(p_org, p.user_id), p.role, p.member_role, p.read_seq,
           p.last_read_at, p.joined_at
      from public.thread_participants p
     where p.thread_id = p_thread and p.left_at is null
     order by p.joined_at, p.user_id;
end;
$$;

-- ── Writes ──────────────────────────────────────────────────────────────────────────────────────

-- The one direct conversation between two people, created on first use. Idempotent on the pair, and
-- safe against two people opening it at the same moment (the unique pair index decides; the loser
-- reads the winner's row).
create or replace function chat_open_direct(p_org uuid, p_actor uuid, p_other uuid, p_thread_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := least(p_actor::text, p_other::text) || ':' || greatest(p_actor::text, p_other::text);
  v_id uuid;
begin
  if p_actor = p_other then
    raise exception 'a direct conversation needs two people' using errcode = 'CH002';
  end if;
  perform public.chat_assert_office_member(p_org, p_actor);
  perform public.chat_assert_office_member(p_org, p_other);
  perform set_config('silvicom.chat_actor', p_actor::text, true);

  select t.id into v_id from public.message_threads t where t.org_id = p_org and t.direct_key = v_key;
  if v_id is not null then
    return v_id;
  end if;
  begin
    insert into public.message_threads (id, org_id, kind, direct_key, created_by)
    values (p_thread_id, p_org, 'direct', v_key, p_actor);
  exception when unique_violation then
    select t.id into v_id from public.message_threads t where t.org_id = p_org and t.direct_key = v_key;
    if v_id is null then
      raise exception 'that id already belongs to another conversation' using errcode = 'CH007';
    end if;
    return v_id;
  end;
  insert into public.thread_participants (thread_id, org_id, user_id, role, member_role)
  values (p_thread_id, p_org, p_actor, 'office', 'member'), (p_thread_id, p_org, p_other, 'office', 'member');
  return p_thread_id;
end;
$$;

-- A group conversation: the creator owns it, everyone named is validated. Idempotent on the client id.
-- 250 people is the group ceiling; a conversation for more is a channel (CH5).
create or replace function chat_create_group(p_org uuid, p_actor uuid, p_thread_id uuid, p_subject text, p_members uuid[])
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.message_threads;
  v_members uuid[];
  v_user uuid;
begin
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

  insert into public.message_threads (id, org_id, kind, subject, created_by)
  values (p_thread_id, p_org, 'group', nullif(btrim(p_subject), ''), p_actor);
  insert into public.thread_participants (thread_id, org_id, user_id, role, member_role)
  select p_thread_id, p_org, u, 'office', case when u = p_actor then 'owner' else 'member' end
    from unnest(v_members) u;
  return p_thread_id;
end;
$$;

-- Send. Idempotent on the client message id: a retried send returns the first one's position.
-- The existence check comes FIRST, before the insert's BEFORE trigger takes a sequence number.
create or replace function chat_send(p_org uuid, p_actor uuid, p_thread uuid, p_message_id uuid, p_body text)
returns table (message_id uuid, seq bigint, rev bigint, created_at timestamptz, duplicate boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_thread public.message_threads;
  v_existing public.messages;
begin
  select m.* into v_existing from public.messages m where m.id = p_message_id;
  if v_existing.id is not null then
    if v_existing.org_id = p_org and v_existing.thread_id = p_thread and v_existing.sender_user_id = p_actor then
      return query select v_existing.id, v_existing.seq, v_existing.rev, v_existing.created_at, true;
      return;
    end if;
    raise exception 'that id already belongs to another message' using errcode = 'CH007';
  end if;

  v_thread := public.chat_member_thread(p_org, p_actor, p_thread);
  -- A driver conversation (0096) is written through /api/messages, which notifies the driver's phone
  -- and counts the driver budget; sending into one here would skip both.
  if v_thread.kind = 'driver' then
    raise exception 'driver conversations are written through dispatch messages' using errcode = 'CH006';
  end if;
  if v_thread.archived_at is not null then
    raise exception 'the conversation is archived' using errcode = 'CH005';
  end if;
  return query
    insert into public.messages as m (id, thread_id, org_id, sender_user_id, body)
    values (p_message_id, p_thread, p_org, p_actor, p_body)
    returning m.id, m.seq, m.rev, m.created_at, false;
end;
$$;

create or replace function chat_edit(p_org uuid, p_actor uuid, p_message uuid, p_body text)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v public.messages;
begin
  select m.* into v from public.messages m where m.id = p_message and m.org_id = p_org;
  if v.id is null then
    raise exception 'not in that conversation' using errcode = 'CH001';
  end if;
  perform public.chat_member_thread(p_org, p_actor, v.thread_id);
  if v.sender_user_id is distinct from p_actor then
    raise exception 'only the author may edit a message' using errcode = 'CH006';
  end if;
  if v.body = p_body then
    return v.rev;
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.messages m set body = p_body where m.id = p_message returning m.rev into v.rev;
  return v.rev;
end;
$$;

-- Retract your own message: it stops rendering; the row, its words and its versions stay (D-CHAT13).
create or replace function chat_retract(p_org uuid, p_actor uuid, p_message uuid)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v public.messages;
begin
  select m.* into v from public.messages m where m.id = p_message and m.org_id = p_org;
  if v.id is null then
    raise exception 'not in that conversation' using errcode = 'CH001';
  end if;
  perform public.chat_member_thread(p_org, p_actor, v.thread_id);
  if v.sender_user_id is distinct from p_actor then
    raise exception 'only the author may retract a message' using errcode = 'CH006';
  end if;
  if v.deleted_at is not null then
    return v.rev;
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.messages m set deleted_at = now() where m.id = p_message returning m.rev into v.rev;
  return v.rev;
end;
$$;

-- Move the caller's read boundary forward (never back, never past the end).
create or replace function chat_mark_read(p_org uuid, p_user uuid, p_thread uuid, p_seq bigint)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  v_thread public.message_threads;
  v_seq bigint;
begin
  v_thread := public.chat_member_thread(p_org, p_user, p_thread);
  update public.thread_participants p
     set read_seq = greatest(p.read_seq, least(coalesce(p_seq, v_thread.last_seq), v_thread.last_seq)),
         last_read_at = now()
   where p.thread_id = p_thread and p.user_id = p_user
  returning p.read_seq into v_seq;
  return v_seq;
end;
$$;

create or replace function chat_rename(p_org uuid, p_actor uuid, p_thread uuid, p_subject text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads;
begin
  v := public.chat_member_thread(p_org, p_actor, p_thread);
  if v.kind <> 'group' then
    raise exception 'only a group conversation has a name' using errcode = 'CH006';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.message_threads t set subject = nullif(btrim(p_subject), '') where t.id = p_thread;
end;
$$;

-- Add people to a group (any member may, as in Teams group chats). Someone who left comes back.
create or replace function chat_add_members(p_org uuid, p_actor uuid, p_thread uuid, p_members uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads;
  v_user uuid;
  v_added integer := 0;
begin
  v := public.chat_member_thread(p_org, p_actor, p_thread);
  if v.kind <> 'group' then
    raise exception 'people are added to a group conversation only' using errcode = 'CH006';
  end if;
  if v.archived_at is not null then
    raise exception 'the conversation is archived' using errcode = 'CH005';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  foreach v_user in array coalesce(p_members, '{}') loop
    perform public.chat_assert_office_member(p_org, v_user);
    if exists (select 1 from public.thread_participants p where p.thread_id = p_thread and p.user_id = v_user) then
      update public.thread_participants p set left_at = null
       where p.thread_id = p_thread and p.user_id = v_user and p.left_at is not null;
    else
      insert into public.thread_participants (thread_id, org_id, user_id, role, member_role)
      values (p_thread, p_org, v_user, 'office', 'member');
    end if;
    if found then v_added := v_added + 1; end if;
  end loop;
  if (select count(*) from public.thread_participants p where p.thread_id = p_thread and p.left_at is null) > 250 then
    raise exception 'a group holds at most 250 people; use a channel' using errcode = 'CH006';
  end if;
  return v_added;
end;
$$;

-- Leave a group, or (an owner) remove somebody. The row stays with `left_at`, so the ledger and the
-- compliance console still know who was in it. A direct conversation cannot be left: it is the pair.
-- A group never ends up without an owner: the longest-standing member is promoted.
create or replace function chat_leave(p_org uuid, p_actor uuid, p_thread uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads;
  v_target uuid := coalesce(p_user, p_actor);
begin
  v := public.chat_member_thread(p_org, p_actor, p_thread);
  if v.kind <> 'group' then
    raise exception 'only a group conversation can be left' using errcode = 'CH006';
  end if;
  if v_target <> p_actor and not exists (
    select 1 from public.thread_participants p
     where p.thread_id = p_thread and p.user_id = p_actor and p.member_role = 'owner' and p.left_at is null
  ) then
    raise exception 'only an owner may remove somebody' using errcode = 'CH008';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.thread_participants p set left_at = now()
   where p.thread_id = p_thread and p.user_id = v_target and p.left_at is null;
  if not found then
    raise exception 'not in that conversation' using errcode = 'CH001';
  end if;
  if not exists (select 1 from public.thread_participants p
                  where p.thread_id = p_thread and p.left_at is null and p.member_role = 'owner') then
    update public.thread_participants p set member_role = 'owner'
     where (p.thread_id, p.user_id) = (
       select o.thread_id, o.user_id from public.thread_participants o
        where o.thread_id = p_thread and o.left_at is null order by o.joined_at, o.user_id limit 1);
  end if;
end;
$$;

-- ── Verification (D-CHAT12; CHA1 runs it nightly) ────────────────────────────────────────────────
-- Recomputes the org's chain after `p_after_seq` (0 = from the start; a checkpoint later) and checks
-- every message's live body against the hash of its latest ledger entry. One row: how many links were
-- checked, and the first problem found (null = intact).
create or replace function chat_ledger_verify(p_org uuid, p_after_seq bigint default 0)
returns table (checked bigint, first_bad_seq bigint, problem text, message_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  r public.chat_ledger;
  v_prev text;
  v_seq bigint := coalesce(p_after_seq, 0);
  v_n bigint := 0;
  v_msg uuid;
  v_why text;
begin
  if v_seq = 0 then
    v_prev := repeat('0', 64);
  else
    select l.hash into v_prev from public.chat_ledger l where l.org_id = p_org and l.seq = v_seq;
    if v_prev is null then
      return query select 0::bigint, v_seq, 'checkpoint row missing'::text, null::uuid;
      return;
    end if;
  end if;

  for r in select * from public.chat_ledger l where l.org_id = p_org and l.seq > v_seq order by l.seq loop
    if r.seq <> v_seq + 1 then
      return query select v_n, v_seq + 1, 'ledger row missing'::text, null::uuid; return;
    end if;
    if r.prev_hash <> v_prev then
      return query select v_n, r.seq, 'chain broken: previous hash does not match'::text, r.message_id; return;
    end if;
    if r.hash <> public.chat_sha256(r.prev_hash || public.chat_ledger_canonical(
         r.org_id, r.seq, r.occurred_at, r.actor_user_id, r.action, r.thread_id, r.message_id,
         r.subject_user_id, r.body_sha256, r.detail)) then
      return query select v_n, r.seq, 'ledger row altered'::text, r.message_id; return;
    end if;
    v_prev := r.hash; v_seq := r.seq; v_n := v_n + 1;
  end loop;

  select m.id, case when l.body_sha256 is null then 'message has no ledger entry'
                    else 'message text differs from the ledger' end
    into v_msg, v_why
    from public.messages m
    left join lateral (
      select x.body_sha256 from public.chat_ledger x
       where x.message_id = m.id and x.org_id = p_org and x.action in ('message_sent', 'message_edited')
       order by x.seq desc limit 1
    ) l on true
   where m.org_id = p_org and (l.body_sha256 is null or l.body_sha256 <> public.chat_sha256(m.body))
   order by m.created_at limit 1;
  return query select v_n, null::bigint, v_why, v_msg;
end;
$$;

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_display_name(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_people(uuid) from public, anon, authenticated;
revoke all on function chat_assert_office_member(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_member_thread(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_inbox(uuid, uuid, text[], timestamptz, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function chat_history(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_sync(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_members(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_open_direct(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_create_group(uuid, uuid, uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function chat_send(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function chat_edit(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function chat_retract(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_mark_read(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke all on function chat_rename(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function chat_add_members(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function chat_leave(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_ledger_verify(uuid, bigint) from public, anon, authenticated;
grant execute on function chat_people(uuid) to service_role;
grant execute on function chat_inbox(uuid, uuid, text[], timestamptz, uuid, integer, uuid) to service_role;
grant execute on function chat_history(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_sync(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_members(uuid, uuid, uuid) to service_role;
grant execute on function chat_open_direct(uuid, uuid, uuid, uuid) to service_role;
grant execute on function chat_create_group(uuid, uuid, uuid, text, uuid[]) to service_role;
grant execute on function chat_send(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function chat_edit(uuid, uuid, uuid, text) to service_role;
grant execute on function chat_retract(uuid, uuid, uuid) to service_role;
grant execute on function chat_mark_read(uuid, uuid, uuid, bigint) to service_role;
grant execute on function chat_rename(uuid, uuid, uuid, text) to service_role;
grant execute on function chat_add_members(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function chat_leave(uuid, uuid, uuid, uuid) to service_role;
grant execute on function chat_ledger_verify(uuid, bigint) to service_role;
