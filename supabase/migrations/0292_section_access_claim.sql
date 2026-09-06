-- 0292 — the section-access claim: overrides become something SQL and the API can ask.
--
-- D-PERM2/D-PERM3/D-PERM4, docs/plans/permissions/EDITABLE-PERMISSIONS-PLAN.md step P2. 0291 gave an
-- org somewhere to record what it wants a role to reach; this migration is what makes that record
-- reachable at authorization time. Nothing consults it yet — the policies are rewritten at P4 and
-- the API/web read it at P3 — so applying this changes no behaviour whatsoever.
--
-- ── WHY THE ANSWER TRAVELS IN THE TOKEN AND NOT IN A JOIN (D-PERM2) ─────────────────────────────
-- Every RLS policy in this product evaluates its predicate PER ROW. Putting `org_section_access` in
-- a subquery inside ~89 predicates would make each of them do a lookup for every row considered, on
-- the read path of the whole application.
--
-- This repo has already paid that bill once and remembers the number: a scalar helper carrying
-- `set search_path` stopped inlining and cost 128x per row, and it took the fuel-spend page down
-- silently — nobody had changed the page. So `auth_section()` below is deliberately shaped like
-- `auth_role()` (0002/0213) and not like anything cleverer: language sql, stable, no security
-- definer, no search_path, no table access. It reads a claim out of a string that is already in
-- memory, and Postgres can fold it into the predicate the same way it folds `auth_role()`.
--
-- The cost of that choice is staleness: a permission change lands when the user's token next
-- refreshes. That is the SAME contract a role change already has — `custom_access_token_hook` has
-- injected `user_role` since 0006, and SettingsUsersPage has warned "you may lose admin access after
-- your next sign-in" for as long. The owner ruled on 2026-09-02 to accept it and say so in the UI
-- (D-PERM6), rather than shorten the org's token lifetime for everybody to serve a rare event.
--
-- ── WHY THE CLAIM IS SPARSE (D-PERM4) ──────────────────────────────────────────────────────────
-- `sections` carries ONLY the overrides. A section that is absent is not denied — it is UNCHANGED,
-- and its answer is the shipped default. The alternative, a complete resolved matrix, would need
-- this function to know the defaults, which means seeding them from packages/shared/src/auth.ts,
-- which means codegen and a drift gate to keep the copy equal to the original.
--
-- Every consumer already holds the defaults in the form it uses. SQL holds them as the
-- `auth_role() = ANY (ARRAY[...])` list already written into each policy — lists that
-- `lint:section-policies` (D-SEP10) has checked against that matrix since 0260 — so P4's policies
-- read:
--
--     case when auth_section('safety') is not null
--          then auth_section('safety') = 'manage'
--          else auth_role() = ANY (ARRAY['admin','fleet_manager','safety_manager'])
--     end
--
-- The role list is not scaffolding to be removed later. It IS the default branch, and it stays.
--
-- The consequence that makes the whole rollout safe: a token minted before this migration carries no
-- `sections` claim at all, so `auth_section()` returns null, every policy takes its default branch,
-- and every live session behaves exactly as it does today. There is no window in which anyone loses
-- access, and no ordering requirement between this and the policy rewrite.
--
-- Rollback: drop function public.auth_section(text); and restore 0006's hook body.

-- ── The reader ──────────────────────────────────────────────────────────────────────────────────
-- `nullif` guards the empty setting a rolled-back `set_local` leaves behind. Without it the cast
-- raises 22P02 rather than returning null — the latent bug 0213 found in `auth_role()` the first
-- time a BEFORE UPDATE trigger called it on a path nothing had called it on before. Copied here
-- rather than rediscovered.
create or replace function auth_section(p_section text)
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'sections' ->> p_section;
$$;

comment on function auth_section(text) is
  'Effective access for one section from the JWT, or NULL meaning "not overridden — use the shipped default" (D-PERM4). Shaped like auth_role() so it inlines: no security definer, no search_path.';

-- ── The two questions a policy actually asks ────────────────────────────────────────────────────
-- Thin wrappers, and `sql`/`stable` for the same inlining reason. They exist so a policy body reads
-- as the question it means rather than as a string comparison, and so P4's rewrite is mechanical.
-- ⚠ `coalesce(..., false)` is LOAD-BEARING, not defensive tidiness. SQL is three-valued: with no
-- claim, `auth_section()` is null, and both `null = 'manage'` and `null in ('view','manage')`
-- evaluate to NULL rather than false. RLS treats a NULL predicate as a refusal — so a bare
-- `using (auth_section_view('fuel'))` would have DENIED every token minted before this migration,
-- which is every token in existence on the day it applies. Caught by
-- "…and both wrappers answer false rather than raising" in supabase/tests/org-section-access.test.mjs.
create or replace function auth_section_manage(p_section text)
returns boolean
language sql
stable
as $$
  select coalesce(auth_section(p_section) = 'manage', false);
$$;

create or replace function auth_section_view(p_section text)
returns boolean
language sql
stable
as $$
  select coalesce(auth_section(p_section) in ('view', 'manage'), false);
$$;

comment on function auth_section_manage(text) is
  'True iff the JWT OVERRIDES this section to manage. False when unset — the caller must fall back to the policy''s own role list (D-PERM4).';
comment on function auth_section_view(text) is
  'True iff the JWT OVERRIDES this section to view or manage. False when unset — see auth_section_manage.';

-- ── The writer ──────────────────────────────────────────────────────────────────────────────────
-- Replaces 0006's body. The membership lookup is unchanged, verbatim, including the defensive
-- `order by created_at asc limit 1` for the one-org-per-user invariant (audit M1) — this migration
-- is not the place to revisit it.
--
-- What is added is the `sections` claim, and only when the org has actually overridden something:
-- an org that has never opened the permissions page mints exactly the token it does today, byte for
-- byte, which is what makes this safe to apply to a live project.
--
-- ⚠ The two locks (D-PERM7/D-PERM8) are applied HERE as well as in 0291's CHECK constraints and in
-- the endpoint. Three layers is not belt-and-braces for its own sake: this function is the one that
-- turns a row into authority, so if a row for `admin` or for the `admin` section ever existed —
-- from a support action, a restore, a future writer — this is the last place that can decline to
-- honour it, and the only one whose failure would be an escalation rather than a bad row.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims    jsonb;
  v_org     uuid;
  v_role    text;
  v_sections jsonb;
begin
  -- A user belongs to exactly one org in v1 (audit M1); pick the earliest membership defensively.
  select m.org_id, m.role::text
    into v_org, v_role
  from public.memberships m
  where m.user_id = (event->>'user_id')::uuid
  order by m.created_at asc
  limit 1;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_org is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));

    -- The sparse delta for THIS user's role in THIS org. `admin` and `driver` can never match, and
    -- the `admin` section can never be returned, whatever rows exist.
    if v_role not in ('admin', 'driver') then
      select jsonb_object_agg(a.section, a.access)
        into v_sections
      from public.org_section_access a
      where a.org_id = v_org
        and a.role = v_role
        and a.section <> 'admin';

      if v_sections is not null then
        claims := jsonb_set(claims, '{sections}', v_sections);
      end if;
    end if;
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The hook is SECURITY DEFINER, so it reads the table regardless; this mirrors 0006's
-- belt-and-suspenders grant for `memberships` so the two reads have the same posture.
grant select on public.org_section_access to supabase_auth_admin;
drop policy if exists org_section_access_auth_admin_read on public.org_section_access;
create policy org_section_access_auth_admin_read on public.org_section_access
  for select to supabase_auth_admin using (true);
