-- Silvicom 360 — 0520 office chat: a `chat.teams` holder manages teams they are not in
-- (docs/plans/messaging/OFFICE-CHAT-PLAN.md CH5b; D-CHAT17, D-CHAT21)
--
-- 0519 took `p_manager` — the API's answer to the `chat.teams` permission — and then asked
-- `chat_member_space` BEFORE it: a holder outside a team was told the team does not exist (CH001), so
-- "admins archive" (Q-CHAT10, D-CHAT17) held only for the teams the admin happened to be in, and
-- nothing listed the teams they were not in. Measured while planning CH5b (2026-10-25); recorded as
-- D-CHAT21 with the Permissions-page change it needed.
--
-- WHAT CHANGES:
--   · `chat_manage_space` — the team when the caller is in it, OR when `p_manager` is true and the team
--     is this org's. Every team act that takes `p_manager` (update, archive, add, remove, set role)
--     now asks it instead of `chat_member_space`. Leaving a team still needs being in it: the target
--     row is looked up and CH001 when there is none.
--   · `chat_team_members` gains `p_manager` (default false, so 0519's callers read as before), so the
--     Settings → Chat teams page can show a team's people to a holder who is not one of them.
--   · `chat_team_directory` — every team of the org, live and archived, with its counts and owners:
--     what the Settings → Chat teams page lists. A holder only (CH008 otherwise).
--
-- WHAT DOES NOT: a holder outside a team still reads NONE of its channels. Reading a conversation is
-- participation (D-CHAT4), and the compliance console (D-CHAT14) is the one place another person's
-- messages are read, with a reason. Managing a team is its membership and its name, never its words.
-- Channel acts (rename, archive, remove from a channel) stay with the people in the team, as 0519 has
-- them; a holder who must close a channel archives the team or joins it.
--
-- `lint:migration-ordering` is blind to functions (it reads columns). `chat_team_members` changes its
-- argument list, so it is dropped by its full 0519 signature and re-created in this one transaction;
-- nothing calls it before CH5b's API, which merges after this file is on staging.
--
-- Rollback: re-run 0519's definitions of the five team functions and `chat_team_members`; drop
-- `chat_manage_space` and `chat_team_directory`. CH5b's routes call them and must be reverted first.

-- ── Rules ───────────────────────────────────────────────────────────────────────────────────────

-- The team the caller may manage: one they are in, or, for a `chat.teams` holder, any of this org's.
create or replace function chat_manage_space(p_org uuid, p_actor uuid, p_space uuid, p_manager boolean)
returns public.chat_spaces
language plpgsql stable security definer set search_path = ''
as $$
declare
  v public.chat_spaces;
begin
  if not coalesce(p_manager, false) then
    return public.chat_member_space(p_org, p_actor, p_space);
  end if;
  select s.* into v from public.chat_spaces s where s.id = p_space and s.org_id = p_org;
  if v.id is null then
    raise exception 'no such team' using errcode = 'CH001';
  end if;
  return v;
end;
$$;

-- ── Team acts: 0519's bodies, with `chat_manage_space` in place of `chat_member_space` ───────────

create or replace function chat_team_update(
  p_org uuid, p_actor uuid, p_space uuid, p_name text, p_description text, p_manager boolean
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.chat_spaces := public.chat_manage_space(p_org, p_actor, p_space, p_manager);
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

create or replace function chat_team_archive(p_org uuid, p_actor uuid, p_space uuid, p_manager boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.chat_spaces := public.chat_manage_space(p_org, p_actor, p_space, p_manager);
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

create or replace function chat_team_add_members(
  p_org uuid, p_actor uuid, p_space uuid, p_members uuid[], p_manager boolean
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v public.chat_spaces := public.chat_manage_space(p_org, p_actor, p_space, p_manager);
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

create or replace function chat_team_remove(p_org uuid, p_actor uuid, p_space uuid, p_user uuid, p_manager boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_user, p_actor);
begin
  -- Leaving yourself is a member's act; taking somebody else out is an owner's or a holder's.
  perform public.chat_manage_space(p_org, p_actor, p_space, v_target <> p_actor and coalesce(p_manager, false));
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
  perform public.chat_manage_space(p_org, p_actor, p_space, p_manager);
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

-- ── Reads ───────────────────────────────────────────────────────────────────────────────────────

drop function if exists chat_team_members(uuid, uuid, uuid);
create function chat_team_members(p_org uuid, p_user uuid, p_space uuid, p_manager boolean default false)
returns table (user_id uuid, name text, role text, space_role text, joined_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.chat_manage_space(p_org, p_user, p_space, p_manager);
  return query
    select m.user_id, public.chat_display_name(p_org, m.user_id),
           (select ms.role::text from public.memberships ms where ms.org_id = p_org and ms.user_id = m.user_id),
           m.space_role, m.joined_at
      from public.chat_space_members m
     where m.space_id = p_space and m.left_at is null
     order by m.space_role, public.chat_display_name(p_org, m.user_id), m.user_id;
end;
$$;

-- Every team of the org, for Settings → Chat teams: live first, then archived; counts, never words.
create or replace function chat_team_directory(p_org uuid, p_actor uuid, p_manager boolean)
returns table (
  space_id uuid, name text, description text, created_at timestamptz, created_by_name text,
  archived_at timestamptz, member_count bigint, channel_count bigint, owners jsonb, is_member boolean
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not coalesce(p_manager, false) then
    raise exception 'only a holder of Chat teams may list every team' using errcode = 'CH008';
  end if;
  return query
    select s.id, s.name, s.description, s.created_at, public.chat_display_name(p_org, s.created_by), s.archived_at,
           (select count(*) from public.chat_space_members m where m.space_id = s.id and m.left_at is null),
           (select count(*) from public.message_threads t where t.space_id = s.id and t.org_id = p_org and t.archived_at is null),
           coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', public.chat_display_name(p_org, m.user_id))
                                      order by public.chat_display_name(p_org, m.user_id))
                       from public.chat_space_members m
                      where m.space_id = s.id and m.left_at is null and m.space_role = 'owner'), '[]'::jsonb),
           exists (select 1 from public.chat_space_members m where m.space_id = s.id and m.user_id = p_actor and m.left_at is null)
      from public.chat_spaces s
     where s.org_id = p_org
     order by s.archived_at is not null, lower(s.name), s.id;
end;
$$;

-- ── Grants: service role only ───────────────────────────────────────────────────────────────────
revoke all on function chat_manage_space(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_team_members(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function chat_team_directory(uuid, uuid, boolean) from public, anon, authenticated;
