-- 0293 — the override reaches the database: dispatch, hazmat, roster and equipment.
--
-- D-PERM3/D-PERM4, docs/plans/permissions/EDITABLE-PERMISSIONS-PLAN.md step P4, batch 1 of 3.
-- 0291 gave an org somewhere to record what it wants a role to reach and 0292 put that record in the
-- token. Until this migration nothing in SQL consulted it, so an override changed the UI and the API
-- and PostgREST went on enforcing the shipped matrix. This closes that gap for 17 policies.
--
-- ── WHAT IS AND IS NOT IN SCOPE, MEASURED ──────────────────────────────────────────────────────
-- 109 policies in the applied schema mention `auth_role()`. Only 58 of them carry a SECTION ROLE
-- LIST (`auth_role() = ANY (ARRAY[...])`); the other 51 are `auth_role() <> 'driver'` guards and
-- driver-scoping predicates, which are not section questions at all. Wrapping those would attach an
-- org-editable answer to "is this caller the driver app", which is not a permission an org has any
-- business editing.
--
-- Of the 58, six more are excluded because their section is not editable: `org`-module tables map to
-- the `admin` section (D-PERM7 makes it ungrantable, so `auth_section('admin')` can never be
-- non-null and a wrapper there would be dead code reading as a live feature), and the
-- `samsara`/`mcleod`/`messaging`/`driver-app` modules have no client-facing section to resolve
-- against. 52 policies remain, and this is the first 17.
--
-- ── THE SHAPE, AND WHY IT IS A CASE RATHER THAN A CLEVERER EXPRESSION ───────────────────────────
-- `coalesce(auth_section('x') = 'manage', <role list>)` would do the same job in one line, because
-- `null = 'manage'` is NULL and coalesce falls through. It is NOT used here on purpose: three-valued
-- logic in an RLS predicate is precisely what nearly shipped a lockout in 0292 (see the `coalesce`
-- note on `auth_section_view`), and a reader who does not hold the whole truth table in their head
-- cannot check a one-liner that depends on it. The helper below spells the three cases out.
--
-- ⚠ The role list STAYS in every policy, and is not scaffolding. It IS the shipped default (D-PERM4)
-- — the reason the database never needed its own copy of `SECTION_ACCESS` — and `lint:section-policies`
-- (D-SEP10) has checked those lists against that matrix since 0260. Deleting them later would put
-- the defaults back to having no home in SQL, and would silently switch every un-overridden org to
-- deny-all.
--
-- ── WHY APPLYING THIS CHANGES NOTHING TODAY ────────────────────────────────────────────────────
-- No `org_section_access` row exists in production, and no token carries a `sections` claim until an
-- org creates one. `auth_section()` therefore returns null for every caller, every policy below
-- takes its default branch, and the behaviour is byte-for-byte what it is now. The PGlite matrices
-- (`rls` 461, `load-lifecycle` 61, `hazmat_rls` 38, `equipment-section-split` 16) are unchanged and
-- must stay green — that is the evidence, not a claim.
--
-- cross-module-waiver: this migration is ONE predicate change applied identically to every policy
-- that asks a section question, and the sections it covers (dispatch, hazmat, roster, equipment) do
-- not line up with module boundaries — `roster` alone owns tables in two sections since D-ROS12, and
-- `equipment` is spread across roster, idle and performance. Splitting by module would produce five
-- migrations performing the same mechanical edit, which multiplies the review surface without
-- separating anything a reviewer would want separated; batching by SECTION is what makes each PR's
-- blast radius one capability, and the matrices are grouped the same way. Batches 2 and 3 (fuel +
-- safety, recruitment + maintenance) will carry the same waiver for the same reason.
--
-- Rollback: re-create each policy below with its bare `auth_role() = ANY (ARRAY[...])` predicate.

-- ── The resolver every policy below calls ───────────────────────────────────────────────────────
-- `p_default` is the policy's own role list, evaluated by the caller and passed in. Passing the
-- ANSWER rather than the section's name is what lets `lint:section-policies` keep reading the list
-- out of the policy body, which is the gate that stops the SQL defaults drifting from auth.ts.
--
-- `language sql` + `stable`, no `security definer`, no `set search_path`, no table access — the same
-- shape as `auth_role()` (0002/0213) and `auth_section()` (0292), so Postgres inlines it into the
-- predicate. A `set search_path` here would stop that inlining and cost 128x per row; that is
-- measured, and it took the fuel-spend page down once already.
create or replace function auth_section_or_default(p_section text, p_level text, p_default boolean)
returns boolean
language sql
stable
as $$
  select case
    -- D-PERM7/D-PERM8 at the layer that actually grants rows. `admin` holds manage everywhere so an
    -- org always has a way back, and `driver` is locked at none; neither can be overridden. 0292's
    -- hook already refuses to MINT such a claim and 0291's CHECK constraints refuse the row behind
    -- it — but this is the last gate before data, and the only one whose failure would hand out
    -- access rather than merely store a bad row. It costs one array comparison that inlines.
    when auth_role() in ('admin', 'driver') then coalesce(p_default, false)
    -- No override: the section is UNCHANGED for this org, so the shipped default answers.
    when auth_section(p_section) is null then coalesce(p_default, false)
    -- Overridden: the org's answer wins outright, including when it narrows to 'none'.
    when p_level = 'manage' then auth_section(p_section) = 'manage'
    else auth_section(p_section) in ('view', 'manage')
  end;
$$;

comment on function auth_section_or_default(text, text, boolean) is
  'Effective section access: the org override when there is one (D-PERM4), else the policy''s own role list, which IS the shipped default. Inlinable by design — never add search_path.';

-- ── dispatch ────────────────────────────────────────────────────────────────────────────────────
drop policy if exists loads_write on loads;
create policy loads_write on loads for all
  using (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])))
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

drop policy if exists load_stops_write on load_stops;
create policy load_stops_write on load_stops for all
  using (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])))
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

drop policy if exists load_stop_photos_write on load_stop_photos;
create policy load_stop_photos_write on load_stop_photos for all
  using (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])))
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

drop policy if exists load_events_manager_insert on load_events;
create policy load_events_manager_insert on load_events for insert
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

-- ── hazmat ──────────────────────────────────────────────────────────────────────────────────────
drop policy if exists hazmat_loads_manager_insert on hazmat_loads;
create policy hazmat_loads_manager_insert on hazmat_loads for insert
  with check (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

drop policy if exists hazmat_loads_manager_update on hazmat_loads;
create policy hazmat_loads_manager_update on hazmat_loads for update
  using (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])))
  with check (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

drop policy if exists hazmat_documents_manager_insert on hazmat_documents;
create policy hazmat_documents_manager_insert on hazmat_documents for insert
  with check (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() = any (array['admin','fleet_manager','dispatcher'])));

-- `reviewer_id = auth_user_id()` is NOT a section question and stays outside the wrapper: a review
-- is signed by the person who performed it, and no org may configure that away.
drop policy if exists hazmat_reviews_insert on hazmat_reviews;
create policy hazmat_reviews_insert on hazmat_reviews for insert
  with check (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() = any (array['admin','fleet_manager','safety_manager'])) and reviewer_id = auth_user_id());

-- The one SELECT in this batch, so the one that asks for 'view' rather than 'manage'.
drop policy if exists hazmat_reviews_select on hazmat_reviews;
create policy hazmat_reviews_select on hazmat_reviews for select
  using (org_id = auth_org_id() and auth_section_or_default('hazmat', 'view',
    auth_role() = any (array['admin','fleet_manager','safety_manager','auditor'])));

-- ── roster ──────────────────────────────────────────────────────────────────────────────────────
drop policy if exists drivers_write on drivers;
create policy drivers_write on drivers for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager','safety_manager','recruiter'])))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager','safety_manager','recruiter'])));

drop policy if exists dva_write on driver_vehicle_assignments;
create policy dva_write on driver_vehicle_assignments for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager'])));

drop policy if exists driver_scores_write on driver_scores;
create policy driver_scores_write on driver_scores for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager'])));

drop policy if exists dpw_write on driver_performance_weeks;
create policy dpw_write on driver_performance_weeks for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() = any (array['admin','fleet_manager'])));

-- ── equipment (the D-ROS12 split: a fact about a machine, not a person) ─────────────────────────
drop policy if exists vehicles_write on vehicles;
create policy vehicles_write on vehicles for all
  using (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager'])));

drop policy if exists trailers_write on trailers;
create policy trailers_write on trailers for all
  using (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager'])));

drop policy if exists idle_events_write on idle_events;
create policy idle_events_write on idle_events for all
  using (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager'])));

drop policy if exists idle_settings_write on idle_settings;
create policy idle_settings_write on idle_settings for all
  using (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager','safety_manager'])))
  with check (org_id = auth_org_id() and auth_section_or_default('equipment', 'manage',
    auth_role() = any (array['admin','fleet_manager','safety_manager'])));
