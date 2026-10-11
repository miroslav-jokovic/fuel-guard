-- 0393 — an office member can be SUSPENDED: access stops, the person and their permissions stay.
--
-- SP7 of docs/plans/permissions/SETTINGS-PERMISSIONS-PLAN.md §4b, ruled by the owner 2026-09-30
-- (Q-SET12 (a); Q-SET6 (a) is the API half that ends the sessions).
--
-- ── WHY A STATE AND NOT ONLY "REMOVE" ─────────────────────────────────────────────────────────
-- Until now an office member could only be removed or revoked, and both DELETE the membership. That
-- takes every per-person section and screen answer with it (`user_section_access` and
-- `user_surface_access` reference `memberships (org_id, user_id)`), so a dispatcher on two weeks'
-- leave, under investigation, or seasonal came back as a fresh invite with the role's defaults —
-- and the per-person answers are the control an admin spent time setting. Suspension keeps the row
-- and everything hanging from it, and turns the access off.
--
-- ── WHAT "OFF" MEANS, AND WHERE EACH HALF IS ENFORCED ─────────────────────────────────────────
--   · The token: `custom_access_token_hook` skips a suspended membership, so the next token (a
--     sign-in or a refresh) carries no `org_id`, no role and no sections — the same token a person
--     with no membership gets, which the web already routes to its "pending" page. Nothing new is
--     taught to RLS: every policy asks `auth_org_id()`, and that is null.
--   · The token already issued: the API ends the person's sessions when it suspends them
--     (`revoke_user_sessions`, 0363), and — SP7's second PR — confirms on each request that the
--     membership a token names is still current and unsuspended. The ACCESS token itself cannot be
--     recalled; RLS reads from the browser stay open until it expires. Measured and said plainly in
--     the plan, not papered over here.
--   · The last admin: 0392's rule now counts only UNSUSPENDED admins, so suspending the last one is
--     refused exactly as demoting them is (AM010), and a suspended admin never counts as the one
--     that keeps the organisation administrable.
--
-- `suspended_by` records who, for the Users page and the audit row's cross-check; it is set null if
-- that admin's account is later deleted, because the audit row, not this column, is the record.
--
-- `org_member_directory()` gains `suspended_at` so the Users page can show and reverse the state. Its
-- return type changes, so it is dropped and re-created (a `create or replace` cannot change the
-- columns of a set-returning function) and its grants are restated from 0301. The API's callers
-- select named fields, so the added column is harmless to code still running on the old build during
-- the deploy window.
--
-- ── ONE MERGE, READERS AFTER ─────────────────────────────────────────────────────────────────
-- The column's only readers in this merge are the three functions below. The API and web readers ship
-- in SP7's second PR, after this is applied (`lint:migration-ordering`, MIGRATION-DISCIPLINE.md).
--
-- Rollback: alter table memberships drop column suspended_by, drop column suspended_at;
--           re-create the hook from 0299, the directory from 0301, and 0392's function.

alter table memberships
  add column suspended_at timestamptz,
  add column suspended_by uuid references auth.users(id) on delete set null;

-- A "by" with no "when" is a record of nothing.
alter table memberships
  add constraint memberships_suspended_by_needs_at check (suspended_at is not null or suspended_by is null);

-- ── The token ────────────────────────────────────────────────────────────────────────────────
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims          jsonb;
  v_org           uuid;
  v_role          text;
  v_sections      jsonb;
  v_user_sections jsonb;
begin
  -- A user belongs to exactly one org in v1 (audit M1); pick the earliest membership defensively.
  -- A SUSPENDED membership mints nothing (0393, Q-SET12): the person signs in and lands where a
  -- person with no membership lands, and every other claim below follows from `v_org` being null.
  select m.org_id, m.role::text
    into v_org, v_role
  from public.memberships m
  where m.user_id = (event->>'user_id')::uuid
    and m.suspended_at is null
  order by m.created_at asc
  limit 1;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_org is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));

    -- The sparse delta for THIS user's role in THIS org, then the one for THIS PERSON. `admin` and
    -- `driver` can never match, and the `admin` section can never be returned, whatever rows exist.
    if v_role not in ('admin', 'driver') then
      select jsonb_object_agg(a.section, a.access)
        into v_sections
      from public.org_section_access a
      where a.org_id = v_org
        and a.role = v_role
        and a.section <> 'admin';

      select jsonb_object_agg(u.section, u.access)
        into v_user_sections
      from public.user_section_access u
      where u.org_id = v_org
        and u.user_id = (event->>'user_id')::uuid
        and u.section <> 'admin';

      -- The person's answers win over their role's (D-SURF6); either half alone is used as it is.
      if v_sections is not null and v_user_sections is not null then
        v_sections := v_sections || v_user_sections;
      elsif v_user_sections is not null then
        v_sections := v_user_sections;
      end if;

      if v_sections is not null then
        claims := jsonb_set(claims, '{sections}', v_sections);
      end if;
    end if;
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- ── The last admin counts only unsuspended admins ────────────────────────────────────────────
create or replace function public.memberships_keep_an_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only a row that WAS an admin can take the last admin away. (A row that was a SUSPENDED admin
  -- needs no early exit: the rule below already guarantees an active admin exists beside it, so the
  -- check passes — tried as a mutant, it changed no case.)
  if old.role <> 'admin' then
    return null;
  end if;

  -- The organisation itself is gone (its delete cascaded here): nobody is left to lock out.
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return null;
  end if;

  if not exists (
    select 1 from public.memberships m
    where m.org_id = old.org_id
      and m.role = 'admin'
      and m.suspended_at is null
  ) then
    raise exception
      'organization % would be left with no active admin: promote or reinstate someone else first',
      old.org_id
      using errcode = 'AM010';
  end if;

  return null;
end;
$$;

-- ── The directory the Users page reads ──────────────────────────────────────────────────────
drop function if exists public.org_member_directory(uuid);
create function public.org_member_directory(p_org_id uuid)
returns table (user_id uuid, email text, full_name text, role user_role, joined_at timestamptz, suspended_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id,
         u.email::text,
         coalesce(p.full_name, d.full_name) as full_name,
         m.role,
         m.created_at as joined_at,
         m.suspended_at
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.user_profiles p on p.user_id = m.user_id
    left join public.drivers d on d.user_id = m.user_id and d.org_id = m.org_id
   where m.org_id = p_org_id
   order by m.created_at;
$$;

revoke all on function public.org_member_directory(uuid) from public, anon, authenticated;
grant execute on function public.org_member_directory(uuid) to service_role;

comment on column memberships.suspended_at is
  'Q-SET12 (0393): when set, the membership mints no org claim and the API refuses its tokens; the row and its per-person access answers are kept so reinstating restores them. Written only by the Users page (members.ts).';
comment on function public.org_member_directory(uuid) is
  'Every member of one organisation with email, display name (profile, else the roster''s driver name), role, join date and (0393) suspended_at — the one read that replaces per-member auth.admin.getUserById calls. Service role only.';
