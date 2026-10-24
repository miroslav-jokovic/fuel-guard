-- Silvicom 360 — 0519 office chat: teams, channels and replies — the functions
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH5a; D-CHAT17, D-CHAT18, D-CHAT19, Q-CHAT10)
--
-- The only writers of 0518's tables and columns, and the reads the Teams rail needs. As in 0512: every
-- rule lives here once, the API passes the caller's org and user from the verified token, and EXECUTE
-- is granted to the service role only — a browser that could call one could name anybody as the actor.
--
-- WHO MAY DO WHAT (Q-CHAT10, ruled: admins make teams, anyone in a team makes channels, admins archive):
--   · make a team                — a holder of `chat.teams` (D-CHAT17). The API asks the surface;
--                                  these functions are told, as `p_manager`, and record the actor.
--   · rename, archive, add or remove people, change roles in a team — a team owner, or a `chat.teams`
--                                  holder (`p_manager`).
--   · make a channel             — any member of the team.
--   · join a public channel      — any member of the team. A private channel is joined by being added
--                                  by somebody in it, and only team members can be added.
--   · rename or archive a channel — its owner (who made it), a team owner, or a `chat.teams` holder.
--   · leave                      — anyone, anything but General: General is the team.
--   Leaving or being removed from a team takes the person out of every channel in it, in the same
--   transaction, so "in the team" and "can read its channels" can never disagree.
--
-- `p_manager` IS THE API'S ANSWER TO A PERMISSION QUESTION, not a rule: the surface matrix (Settings →
-- Permissions) lives in the API's resolver, and asking it here would be a second copy of the matrix.
--
-- Error codes (the API maps them in chat.ts):
--   CH001  not in that team or conversation, or it does not exist here (→ 404)
--   CH002  that person cannot be in it: not an office member, or not in the team (→ 422)
--   CH005  the team or channel is archived (→ 409)
--   CH006  not for this kind: General cannot be left, renamed or archived; a private channel is not joined (→ 422)
--   CH007  that id already belongs to something else (→ 409)
--   CH008  only an owner (or a `chat.teams` holder) may do that (→ 403)
--   CH011  a reply's post is wrong (0518) (→ 422)
--   CH012  a live team or channel already has that name (→ 409)
--
-- Rollback: drop the functions below; restore 0512's `chat_history` and `chat_sync`. CH5b's routes
-- call them and must be reverted first.

-- ── Rules ───────────────────────────────────────────────────────────────────────────────────────

-- The team, if the user is an active member of it; CH001 otherwise.
create or replace function chat_member_space(p_org uuid, p_user uuid, p_space uuid)
returns public.chat_spaces
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.chat_spaces;
begin
  select s.* into v from public.chat_spaces s
   where s.id = p_space and s.org_id = p_org
     and exists (select 1 from public.chat_space_members m
                  where m.space_id = s.id and m.user_id = p_user and m.left_at is null);
  if v.id is null then
    raise exception 'not in that team' using errcode = 'CH001';
  end if;
  return v;
end;
$$;

create or replace function chat_assert_space_owner(p_space uuid, p_user uuid, p_manager boolean) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if coalesce(p_manager, false) then
    return;
  end if;
  if not exists (select 1 from public.chat_space_members m
                  where m.space_id = p_space and m.user_id = p_user and m.space_role = 'owner' and m.left_at is null) then
    raise exception 'only a team owner may do that' using errcode = 'CH008';
  end if;
end;
$$;

-- The channel, if it is this org's; CH001 otherwise. (Reading needs participation: chat_member_thread.)
create or replace function chat_channel_row(p_org uuid, p_thread uuid) returns public.message_threads
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.message_threads;
begin
  select t.* into v from public.message_threads t where t.id = p_thread and t.org_id = p_org and t.kind = 'channel';
  if v.id is null then
    raise exception 'no such channel' using errcode = 'CH001';
  end if;
  return v;
end;
$$;

-- Put a person into a conversation, or back into it after they left.
create or replace function chat_join_thread(p_org uuid, p_thread uuid, p_user uuid, p_member_role text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  update public.thread_participants p set left_at = null
   where p.thread_id = p_thread and p.user_id = p_user and p.left_at is not null;
  if found then
    return true;
  end if;
  if exists (select 1 from public.thread_participants p where p.thread_id = p_thread and p.user_id = p_user) then
    return false;
  end if;
  insert into public.thread_participants (thread_id, org_id, user_id, role, member_role)
  values (p_thread, p_org, p_user, 'office', coalesce(p_member_role, 'member'));
  return true;
end;
$$;

-- ── Teams ───────────────────────────────────────────────────────────────────────────────────────

-- A team, its General channel, and its first people (the creator owns it). Idempotent on the id.
create or replace function chat_team_create(
  p_org uuid, p_actor uuid, p_space_id uuid, p_general_id uuid, p_name text, p_description text, p_members uuid[]
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_existing public.chat_spaces;
  v_members uuid[];
  v_user uuid;
begin
  select s.* into v_existing from public.chat_spaces s where s.id = p_space_id;
  if v_existing.id is not null then
    if v_existing.org_id = p_org and v_existing.created_by = p_actor then
      return v_existing.id;
    end if;
    raise exception 'that id already belongs to another team' using errcode = 'CH007';
  end if;
  if exists (select 1 from public.message_threads t where t.id = p_general_id) then
    raise exception 'that id already belongs to another conversation' using errcode = 'CH007';
  end if;

  select array_agg(distinct u) into v_members from unnest(coalesce(p_members, '{}') || p_actor) u where u is not null;
  foreach v_user in array v_members loop
    perform public.chat_assert_office_member(p_org, v_user);
  end loop;
  perform set_config('silvicom.chat_actor', p_actor::text, true);

  begin
    insert into public.chat_spaces (id, org_id, name, description, created_by)
    values (p_space_id, p_org, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_actor);
  exception when unique_violation then
    raise exception 'a team called % already exists', btrim(p_name) using errcode = 'CH012';
  end;
  insert into public.chat_space_members (space_id, org_id, user_id, space_role)
  select p_space_id, p_org, u, case when u = p_actor then 'owner' else 'member' end from unnest(v_members) u;

  insert into public.message_threads (id, org_id, kind, subject, created_by, space_id, visibility, general)
  values (p_general_id, p_org, 'channel', 'General', p_actor, p_space_id, 'public', true);
  insert into public.thread_participants (thread_id, org_id, user_id, role, member_role)
  select p_general_id, p_org, u, 'office', case when u = p_actor then 'owner' else 'member' end from unnest(v_members) u;
  return p_space_id;
end;
$$;

create or replace function chat_team_update(
  p_org uuid, p_actor uuid, p_space uuid, p_name text, p_description text, p_manager boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.chat_spaces := public.chat_member_space(p_org, p_actor, p_space);
begin
  perform public.chat_assert_space_owner(p_space, p_actor, p_manager);
  if v.archived_at is not null then
    raise exception 'the team is archived' using errcode = 'CH005';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  begin
    update public.chat_spaces s
       set name = coalesce(nullif(btrim(coalesce(p_name, '')), ''), s.name),
           description = case when p_description is null then s.description else nullif(btrim(p_description), '') end
     where s.id = p_space;
  exception when unique_violation then
    raise exception 'a team called % already exists', btrim(p_name) using errcode = 'CH012';
  end;
end;
$$;

-- Archive a team and every channel in it: nothing more is written, everything stays readable to the
-- people who were in it and to the compliance console.
create or replace function chat_team_archive(p_org uuid, p_actor uuid, p_space uuid, p_manager boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.chat_spaces := public.chat_member_space(p_org, p_actor, p_space);
begin
  perform public.chat_assert_space_owner(p_space, p_actor, p_manager);
  if v.archived_at is not null then
    return;
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.chat_spaces s set archived_at = now() where s.id = p_space;
  update public.message_threads t set archived_at = now()
   where t.space_id = p_space and t.org_id = p_org and t.archived_at is null;
end;
$$;

-- Add people to a team (and to its General channel). Somebody who left comes back. Returns how many
-- were added or returned.
create or replace function chat_team_add_members(
  p_org uuid, p_actor uuid, p_space uuid, p_members uuid[], p_manager boolean
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v public.chat_spaces := public.chat_member_space(p_org, p_actor, p_space);
  v_general uuid;
  v_user uuid;
  v_added integer := 0;
begin
  perform public.chat_assert_space_owner(p_space, p_actor, p_manager);
  if v.archived_at is not null then
    raise exception 'the team is archived' using errcode = 'CH005';
  end if;
  select t.id into v_general from public.message_threads t where t.space_id = p_space and t.general;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  foreach v_user in array coalesce(p_members, '{}') loop
    perform public.chat_assert_office_member(p_org, v_user);
    update public.chat_space_members m set left_at = null, joined_at = now()
     where m.space_id = p_space and m.user_id = v_user and m.left_at is not null;
    if found then
      v_added := v_added + 1;
    elsif not exists (select 1 from public.chat_space_members m where m.space_id = p_space and m.user_id = v_user) then
      insert into public.chat_space_members (space_id, org_id, user_id) values (p_space, p_org, v_user);
      v_added := v_added + 1;
    end if;
    perform public.chat_join_thread(p_org, v_general, v_user, 'member');
  end loop;
  return v_added;
end;
$$;

-- Leave a team, or (an owner, a `chat.teams` holder) take somebody out of it. Either way the person
-- leaves every channel of the team in the same transaction. A team never ends up without an owner.
create or replace function chat_team_remove(p_org uuid, p_actor uuid, p_space uuid, p_user uuid, p_manager boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_user, p_actor);
begin
  perform public.chat_member_space(p_org, p_actor, p_space);
  if v_target <> p_actor then
    perform public.chat_assert_space_owner(p_space, p_actor, p_manager);
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.chat_space_members m set left_at = now()
   where m.space_id = p_space and m.user_id = v_target and m.left_at is null;
  if not found then
    raise exception 'not in that team' using errcode = 'CH001';
  end if;
  update public.thread_participants p set left_at = now()
   where p.user_id = v_target and p.left_at is null
     and p.thread_id in (select t.id from public.message_threads t where t.space_id = p_space);
  if not exists (select 1 from public.chat_space_members m
                  where m.space_id = p_space and m.left_at is null and m.space_role = 'owner') then
    update public.chat_space_members m set space_role = 'owner'
     where (m.space_id, m.user_id) = (
       select o.space_id, o.user_id from public.chat_space_members o
        where o.space_id = p_space and o.left_at is null order by o.joined_at, o.user_id limit 1);
  end if;
end;
$$;

create or replace function chat_team_set_role(
  p_org uuid, p_actor uuid, p_space uuid, p_user uuid, p_role text, p_manager boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.chat_member_space(p_org, p_actor, p_space);
  perform public.chat_assert_space_owner(p_space, p_actor, p_manager);
  if p_role not in ('owner', 'member') then
    raise exception 'a team role is owner or member' using errcode = 'CH006';
  end if;
  if p_role = 'member' and not exists (
    select 1 from public.chat_space_members m
     where m.space_id = p_space and m.left_at is null and m.space_role = 'owner' and m.user_id <> p_user
  ) then
    raise exception 'a team keeps at least one owner' using errcode = 'CH006';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.chat_space_members m set space_role = p_role
   where m.space_id = p_space and m.user_id = p_user and m.left_at is null;
  if not found then
    raise exception 'that person is not in the team' using errcode = 'CH001';
  end if;
end;
$$;

-- ── Channels ────────────────────────────────────────────────────────────────────────────────────

-- A channel in a team the creator is in. Public: the creator joins and everyone in the team may.
-- Private: the creator and the people named, each of whom must be in the team. Idempotent on the id.
create or replace function chat_channel_create(
  p_org uuid, p_actor uuid, p_space uuid, p_thread_id uuid, p_name text, p_visibility text, p_members uuid[]
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v public.chat_spaces := public.chat_member_space(p_org, p_actor, p_space);
  v_existing public.message_threads;
  v_user uuid;
begin
  select t.* into v_existing from public.message_threads t where t.id = p_thread_id;
  if v_existing.id is not null then
    if v_existing.org_id = p_org and v_existing.space_id = p_space and v_existing.created_by = p_actor then
      return v_existing.id;
    end if;
    raise exception 'that id already belongs to another conversation' using errcode = 'CH007';
  end if;
  if v.archived_at is not null then
    raise exception 'the team is archived' using errcode = 'CH005';
  end if;
  if p_visibility not in ('public', 'private') then
    raise exception 'a channel is public or private' using errcode = 'CH006';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 or lower(btrim(p_name)) = 'general' then
    raise exception 'a channel needs a name of up to 80 characters, other than General' using errcode = 'CH006';
  end if;
  if p_visibility = 'private' then
    foreach v_user in array coalesce(p_members, '{}') loop
      if not exists (select 1 from public.chat_space_members m
                      where m.space_id = p_space and m.user_id = v_user and m.left_at is null) then
        raise exception 'everyone in a private channel must be in the team' using errcode = 'CH002';
      end if;
    end loop;
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  begin
    insert into public.message_threads (id, org_id, kind, subject, created_by, space_id, visibility)
    values (p_thread_id, p_org, 'channel', btrim(p_name), p_actor, p_space, p_visibility);
  exception when unique_violation then
    raise exception 'the team already has a channel called %', btrim(p_name) using errcode = 'CH012';
  end;
  perform public.chat_join_thread(p_org, p_thread_id, p_actor, 'owner');
  if p_visibility = 'private' then
    foreach v_user in array coalesce(p_members, '{}') loop
      if v_user <> p_actor then
        perform public.chat_join_thread(p_org, p_thread_id, v_user, 'member');
      end if;
    end loop;
  end if;
  return p_thread_id;
end;
$$;

-- Join a public channel of a team you are in.
create or replace function chat_channel_join(p_org uuid, p_actor uuid, p_thread uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads := public.chat_channel_row(p_org, p_thread);
begin
  perform public.chat_member_space(p_org, p_actor, v.space_id);
  if v.visibility <> 'public' then
    raise exception 'a private channel is joined by being added' using errcode = 'CH006';
  end if;
  if v.archived_at is not null then
    raise exception 'the channel is archived' using errcode = 'CH005';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  perform public.chat_join_thread(p_org, p_thread, p_actor, 'member');
end;
$$;

-- Add people from the team to a channel you are in (any member may, as in a group).
create or replace function chat_channel_add_members(p_org uuid, p_actor uuid, p_thread uuid, p_members uuid[])
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads := public.chat_member_thread(p_org, p_actor, p_thread);
  v_user uuid;
  v_added integer := 0;
begin
  if v.kind <> 'channel' then
    raise exception 'that is not a channel' using errcode = 'CH006';
  end if;
  if v.archived_at is not null then
    raise exception 'the channel is archived' using errcode = 'CH005';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  foreach v_user in array coalesce(p_members, '{}') loop
    if not exists (select 1 from public.chat_space_members m
                    where m.space_id = v.space_id and m.user_id = v_user and m.left_at is null) then
      raise exception 'only people in the team can be added to its channels' using errcode = 'CH002';
    end if;
    if public.chat_join_thread(p_org, p_thread, v_user, 'member') then
      v_added := v_added + 1;
    end if;
  end loop;
  return v_added;
end;
$$;

-- Leave a channel, or (its owner, a team owner, a `chat.teams` holder) take somebody out. Not General.
create or replace function chat_channel_leave(p_org uuid, p_actor uuid, p_thread uuid, p_user uuid, p_manager boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads := public.chat_member_thread(p_org, p_actor, p_thread);
  v_target uuid := coalesce(p_user, p_actor);
begin
  if v.kind <> 'channel' then
    raise exception 'that is not a channel' using errcode = 'CH006';
  end if;
  if v.general then
    raise exception 'General is the team: leave the team instead' using errcode = 'CH006';
  end if;
  if v_target <> p_actor and not coalesce(p_manager, false)
     and not exists (select 1 from public.thread_participants p
                      where p.thread_id = p_thread and p.user_id = p_actor and p.member_role = 'owner' and p.left_at is null)
     and not exists (select 1 from public.chat_space_members m
                      where m.space_id = v.space_id and m.user_id = p_actor and m.space_role = 'owner' and m.left_at is null) then
    raise exception 'only an owner may remove somebody' using errcode = 'CH008';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.thread_participants p set left_at = now()
   where p.thread_id = p_thread and p.user_id = v_target and p.left_at is null;
  if not found then
    raise exception 'not in that channel' using errcode = 'CH001';
  end if;
end;
$$;

-- Rename or archive a channel: its owner, a team owner or a `chat.teams` holder. Never General.
create or replace function chat_channel_assert_manage(v public.message_threads, p_actor uuid, p_manager boolean) returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if v.general then
    raise exception 'General stays as it is' using errcode = 'CH006';
  end if;
  if coalesce(p_manager, false) or v.created_by = p_actor
     or exists (select 1 from public.chat_space_members m
                 where m.space_id = v.space_id and m.user_id = p_actor and m.space_role = 'owner' and m.left_at is null) then
    return;
  end if;
  raise exception 'only the channel''s owner or a team owner may do that' using errcode = 'CH008';
end;
$$;

create or replace function chat_channel_rename(p_org uuid, p_actor uuid, p_thread uuid, p_name text, p_manager boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads := public.chat_channel_row(p_org, p_thread);
begin
  perform public.chat_member_space(p_org, p_actor, v.space_id);
  perform public.chat_channel_assert_manage(v, p_actor, p_manager);
  if nullif(btrim(coalesce(p_name, '')), '') is null or length(btrim(p_name)) > 80 or lower(btrim(p_name)) = 'general' then
    raise exception 'a channel needs a name of up to 80 characters, other than General' using errcode = 'CH006';
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  begin
    update public.message_threads t set subject = btrim(p_name) where t.id = p_thread;
  exception when unique_violation then
    raise exception 'the team already has a channel called %', btrim(p_name) using errcode = 'CH012';
  end;
end;
$$;

create or replace function chat_channel_archive(p_org uuid, p_actor uuid, p_thread uuid, p_manager boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.message_threads := public.chat_channel_row(p_org, p_thread);
begin
  perform public.chat_member_space(p_org, p_actor, v.space_id);
  perform public.chat_channel_assert_manage(v, p_actor, p_manager);
  if v.archived_at is not null then
    return;
  end if;
  perform set_config('silvicom.chat_actor', p_actor::text, true);
  update public.message_threads t set archived_at = now() where t.id = p_thread;
end;
$$;

-- A reply to a channel post. Idempotent on the client id, as `chat_send`; 0518's trigger checks the post.
create or replace function chat_send_reply(
  p_org uuid, p_actor uuid, p_thread uuid, p_message_id uuid, p_parent uuid, p_body text
) returns table (message_id uuid, seq bigint, rev bigint, created_at timestamptz, duplicate boolean)
language plpgsql security definer set search_path = ''
as $$
declare
  v_thread public.message_threads;
  v_existing public.messages;
begin
  select m.* into v_existing from public.messages m where m.id = p_message_id;
  if v_existing.id is not null then
    if v_existing.org_id = p_org and v_existing.thread_id = p_thread and v_existing.sender_user_id = p_actor
       and v_existing.parent_id is not distinct from p_parent then
      return query select v_existing.id, v_existing.seq, v_existing.rev, v_existing.created_at, true;
      return;
    end if;
    raise exception 'that id already belongs to another message' using errcode = 'CH007';
  end if;
  v_thread := public.chat_member_thread(p_org, p_actor, p_thread);
  if v_thread.archived_at is not null then
    raise exception 'the conversation is archived' using errcode = 'CH005';
  end if;
  return query
    insert into public.messages as m (id, thread_id, org_id, sender_user_id, body, parent_id)
    values (p_message_id, p_thread, p_org, p_actor, p_body, p_parent)
    returning m.id, m.seq, m.rev, m.created_at, false;
end;
$$;

-- ── Reads ───────────────────────────────────────────────────────────────────────────────────────

-- The Teams rail: every live team the user is in, with the channels they can see — every public one
-- (joined or not) and the private ones they are in — and, for the ones they are in, the unread count.
create or replace function chat_teams(p_org uuid, p_user uuid)
returns table (
  space_id uuid, name text, description text, space_role text, member_count bigint, created_at timestamptz, channels jsonb
)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.name, s.description, me.space_role,
         (select count(*) from public.chat_space_members o where o.space_id = s.id and o.left_at is null),
         s.created_at,
         coalesce((
           select jsonb_agg(jsonb_build_object(
                    'thread_id', t.id, 'name', t.subject, 'visibility', t.visibility, 'general', t.general,
                    'joined', p.user_id is not null, 'last_message_at', t.last_message_at, 'last_seq', t.last_seq,
                    'read_seq', p.read_seq, 'unread', case when p.user_id is null then 0 else greatest(t.last_seq - p.read_seq, 0) end,
                    'muted', p.muted)
                  order by t.general desc, lower(t.subject))
             from public.message_threads t
             left join public.thread_participants p on p.thread_id = t.id and p.user_id = p_user and p.left_at is null
            where t.space_id = s.id and t.org_id = p_org and t.archived_at is null
              and (t.visibility = 'public' or p.user_id is not null)
         ), '[]'::jsonb)
    from public.chat_spaces s
    join public.chat_space_members me on me.space_id = s.id and me.user_id = p_user and me.left_at is null
   where s.org_id = p_org and s.archived_at is null
   order by lower(s.name), s.id;
$$;

create or replace function chat_team_members(p_org uuid, p_user uuid, p_space uuid)
returns table (user_id uuid, name text, role text, space_role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_space(p_org, p_user, p_space);
  return query
    select m.user_id, public.chat_display_name(p_org, m.user_id),
           (select ms.role::text from public.memberships ms where ms.org_id = p_org and ms.user_id = m.user_id),
           m.space_role, m.joined_at
      from public.chat_space_members m
     where m.space_id = p_space and m.left_at is null
     order by m.space_role, public.chat_display_name(p_org, m.user_id), m.user_id;
end;
$$;

-- A channel's top-level posts, newest first, before `p_before_seq`; each with its reply counters.
create or replace function chat_channel_posts(p_org uuid, p_user uuid, p_thread uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer, last_reply_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org and m.parent_id is null
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- One post's replies, newest first, before `p_before_seq`.
create or replace function chat_replies(p_org uuid, p_user uuid, p_parent uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer, last_reply_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_thread uuid;
begin
  select m.thread_id into v_thread from public.messages m where m.id = p_parent and m.org_id = p_org;
  if v_thread is null then
    raise exception 'no such post' using errcode = 'CH001';
  end if;
  perform public.chat_member_thread(p_org, p_user, v_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at
      from public.messages m
     where m.parent_id = p_parent and m.org_id = p_org
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- 0512's history and sync, now with each line's post and reply counters, so a channel's one ordered
-- log tells a client where every change belongs. Same arguments; three more columns, which callers
-- that do not know them drop (the API parses with schemas that strip unknown keys).
drop function if exists chat_history(uuid, uuid, uuid, bigint, integer);
create function chat_history(p_org uuid, p_user uuid, p_thread uuid, p_before_seq bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer, last_reply_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org
       and (p_before_seq is null or m.seq < p_before_seq)
     order by m.seq desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

drop function if exists chat_sync(uuid, uuid, uuid, bigint, integer);
create function chat_sync(p_org uuid, p_user uuid, p_thread uuid, p_since_rev bigint, p_limit integer)
returns table (
  id uuid, thread_id uuid, seq bigint, rev bigint, sender_user_id uuid, sender_name text, body text,
  created_at timestamptz, edited_at timestamptz, deleted_at timestamptz, parent_id uuid, reply_count integer, last_reply_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_member_thread(p_org, p_user, p_thread);
  return query
    select m.id, m.thread_id, m.seq, m.rev, m.sender_user_id, public.chat_display_name(p_org, m.sender_user_id),
           case when m.deleted_at is null then m.body end, m.created_at, m.edited_at, m.deleted_at,
           m.parent_id, m.reply_count, m.last_reply_at
      from public.messages m
     where m.thread_id = p_thread and m.org_id = p_org and m.rev > coalesce(p_since_rev, 0)
     order by m.rev
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_member_space(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_assert_space_owner(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_channel_row(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_join_thread(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function chat_team_create(uuid, uuid, uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
revoke all on function chat_team_update(uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function chat_team_archive(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_team_add_members(uuid, uuid, uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function chat_team_remove(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_team_set_role(uuid, uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function chat_channel_create(uuid, uuid, uuid, uuid, text, text, uuid[]) from public, anon, authenticated;
revoke all on function chat_channel_join(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_channel_add_members(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function chat_channel_leave(uuid, uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_channel_assert_manage(public.message_threads, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_channel_rename(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function chat_channel_archive(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_send_reply(uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function chat_teams(uuid, uuid) from public, anon, authenticated;
revoke all on function chat_team_members(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function chat_channel_posts(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_replies(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_history(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
revoke all on function chat_sync(uuid, uuid, uuid, bigint, integer) from public, anon, authenticated;
grant execute on function chat_team_create(uuid, uuid, uuid, uuid, text, text, uuid[]) to service_role;
grant execute on function chat_team_update(uuid, uuid, uuid, text, text, boolean) to service_role;
grant execute on function chat_team_archive(uuid, uuid, uuid, boolean) to service_role;
grant execute on function chat_team_add_members(uuid, uuid, uuid, uuid[], boolean) to service_role;
grant execute on function chat_team_remove(uuid, uuid, uuid, uuid, boolean) to service_role;
grant execute on function chat_team_set_role(uuid, uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function chat_channel_create(uuid, uuid, uuid, uuid, text, text, uuid[]) to service_role;
grant execute on function chat_channel_join(uuid, uuid, uuid) to service_role;
grant execute on function chat_channel_add_members(uuid, uuid, uuid, uuid[]) to service_role;
grant execute on function chat_channel_leave(uuid, uuid, uuid, uuid, boolean) to service_role;
grant execute on function chat_channel_rename(uuid, uuid, uuid, text, boolean) to service_role;
grant execute on function chat_channel_archive(uuid, uuid, uuid, boolean) to service_role;
grant execute on function chat_send_reply(uuid, uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function chat_teams(uuid, uuid) to service_role;
grant execute on function chat_team_members(uuid, uuid, uuid) to service_role;
grant execute on function chat_channel_posts(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_replies(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_history(uuid, uuid, uuid, bigint, integer) to service_role;
grant execute on function chat_sync(uuid, uuid, uuid, bigint, integer) to service_role;
