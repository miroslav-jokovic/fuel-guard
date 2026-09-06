-- 0295 — the override reaches the database: recruitment and maintenance. The last P4 batch.
--
-- D-PERM3/D-PERM4, docs/plans/permissions/EDITABLE-PERMISSIONS-PLAN.md step P4, batch 3 of 3.
-- 0293 did dispatch, hazmat, roster and equipment; 0294 did fuel and safety and added §2c's method
-- (compare each policy's role list to the matrix, rather than matching a pattern). This finishes the
-- job with 14 policies, after which every section gate an org can edit asks the org.
--
-- ── WHAT THIS BATCH IS, COUNTED THE §2c WAY ────────────────────────────────────────────────────
--   recruitment  5 wrapped — 4 on recruiting's own tables plus `psp_requests_section_read`
--   roster       1 wrapped — `seven_day_statements_write`, which is a roster gate (see below)
--   maintenance  8 wrapped — 4 manage + 4 view, and the only section where every policy already
--                            agreed with the matrix
--   excluded     1 — `employer_inquiries_read`, a fifth D-PERM9 regulatory reader test
--
-- ── TWO TABLES WHOSE MODULE AND SECTION DIFFER, WHICH IS WHAT `TABLE_SECTIONS` IS FOR ──────────
-- Module ownership answers "which code may write this table"; section membership answers "which role
-- may act here". check-section-policies.mjs has said they are different questions since the D-ROS12
-- split, and two tables in this batch are the second and third cases of it. Both are read off the
-- shipped default rather than decided here — in each case the policy's existing role list is EXACTLY
-- one section's derived set, and the migration that wrote it says so in words:
--
--   `psp_requests`          module `psp` → section `safety`, but its list is exactly
--                           `rolesThatCanView('recruitment')` and 0216's header calls it "hiring
--                           paperwork, behind the hiring section". Section: recruitment.
--   `seven_day_statements`  module `recruiting` → section `recruitment`, but its list is exactly
--                           `rolesThatManage('roster')` and 0236's header says it "takes the fleet
--                           lifecycle roles — the same set 0213 allows to move a driver through
--                           their employment status". That helper, `canWriteDriverLifecycle()`, is
--                           literally `canManageSection(role, "roster")`. Section: roster.
--
-- Neither is a re-classification: wrapping each with the section its own list already derives from
-- is the only choice that changes no behaviour. Wrapping them with their MODULE's section would.
--
-- ── `employer_inquiries_read` IS THE FIFTH D-PERM9 READER TEST, NOT A SECTION GATE ─────────────
-- Its list is ['admin','safety_manager','recruiter'], which is no section's derived set — recruitment
-- manage adds the fleet manager. 0223's header explains why, and it is the same regulation D-PERM9
-- already carves out:
--
--   §391.23(k)(2) — "take all precautions reasonably necessary to protect the records from
--                    disclosure to any person not directly involved in deciding whether to hire the
--                    driver." 0223 mirrors `canReadInvestigationHistory` rather than restating it.
--
-- So it stays a bare role check for the reason the four safety ones do: an org granting
-- `recruitment: manage` to a dispatcher must not thereby hand them a former employer's answer about
-- somebody. D-PERM9 now names five policies across two tables' worth of regulation.
--
-- ── THE DRIVER ESCAPE STAYS OUTSIDE THE WRAPPER ────────────────────────────────────────────────
-- The three RESTRICTIVE `_section_read` policies are shaped `auth_role() = 'driver' OR <role list>`.
-- The `driver` disjunct is not a section question — it is what lets somebody read the consent they
-- personally gave and the record it bought, and the companion `_driver_scope` restrictive policies
-- narrow that to their own rows. It stays outside, exactly as `reviewer_id = auth_user_id()` did in
-- 0293. (Belt and braces: `auth_section_or_default` short-circuits `driver` to the default branch
-- anyway under D-PERM8, so a driver could never be granted through the wrapper either.)
--
-- ── APPEND-ONLY, AGAIN, AND UNCHANGED ──────────────────────────────────────────────────────────
-- `vehicle_inspections` and `vehicle_inspection_items` are pinned in `RETENTION_FORBIDDEN` under
-- §396.21(b)'s fourteen months and frozen once final by 0280's trigger; `driver_employment_history`,
-- `employer_inquiries`, `driver_authorizations` and `psp_requests` are pinned too. As in 0294:
-- retention is a guard test over `RETENTION_RULES` and the freeze is a trigger, both different
-- mechanisms at different layers from RLS. No policy below gains or loses a command.
--
-- ── WHY APPLYING THIS CHANGES NOTHING TODAY ────────────────────────────────────────────────────
-- Unchanged from 0293 and 0294: no `org_section_access` row exists in production, so no token carries
-- a `sections` claim, so `auth_section()` is null for every caller and every policy below takes its
-- default branch. The evidence is the existing matrices passing UNCHANGED, quoted in the PR.
--
-- cross-module-waiver: one predicate change applied identically to every policy that asks a section
-- question, across sections that do not line up with module boundaries — `recruitment` spans the
-- recruiting and psp modules and `roster` reaches into recruiting's tables, which is the whole point
-- of the two TABLE_SECTIONS entries above. Splitting by module would produce four migrations doing
-- the same mechanical edit. 0293 and 0294 carried this waiver for the same reason.
--
-- Rollback: re-create each policy below with its bare `auth_role() in (...)` predicate.

-- ── recruitment (5) ─────────────────────────────────────────────────────────────────────────────
-- Recruitment's manage set is [admin, fleet_manager, safety_manager, recruiter]; its view set adds
-- the auditor.

drop policy if exists driver_authorizations_insert on driver_authorizations;
create policy driver_authorizations_insert on driver_authorizations for insert
  with check (org_id = auth_org_id() and auth_section_or_default('recruitment', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager','recruiter')));

drop policy if exists driver_authorizations_section_read on driver_authorizations;
create policy driver_authorizations_section_read on driver_authorizations
  as restrictive for select using (
    auth_role() = 'driver' or auth_section_or_default('recruitment', 'view',
      auth_role() in ('admin','fleet_manager','safety_manager','auditor','recruiter')));

drop policy if exists driver_employment_history_write on driver_employment_history;
create policy driver_employment_history_write on driver_employment_history for all
  using (org_id = auth_org_id() and auth_section_or_default('recruitment', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager','recruiter')))
  with check (org_id = auth_org_id() and auth_section_or_default('recruitment', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager','recruiter')));

drop policy if exists driver_employment_history_section_read on driver_employment_history;
create policy driver_employment_history_section_read on driver_employment_history
  as restrictive for select using (
    auth_role() = 'driver' or auth_section_or_default('recruitment', 'view',
      auth_role() in ('admin','fleet_manager','safety_manager','auditor','recruiter')));

-- The `psp` module's table, on the `recruitment` section — see the TABLE_SECTIONS note above.
drop policy if exists psp_requests_section_read on psp_requests;
create policy psp_requests_section_read on psp_requests
  as restrictive for select using (
    auth_role() = 'driver' or auth_section_or_default('recruitment', 'view',
      auth_role() in ('admin','fleet_manager','safety_manager','auditor','recruiter')));

-- ── roster (1) ──────────────────────────────────────────────────────────────────────────────────
-- Recruiting's table, on the `roster` section, because recording a seven-day statement takes the
-- employment-lifecycle roles and that helper IS `canManageSection(role, "roster")`.
drop policy if exists seven_day_statements_write on seven_day_statements;
create policy seven_day_statements_write on seven_day_statements for insert
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager')));

-- ── maintenance (8) ─────────────────────────────────────────────────────────────────────────────
-- Manage is [admin, fleet_manager, technician]; view adds the auditor and the accountant. Every
-- policy here already agreed with the matrix, which is what being "born checked" (D-SEP10) buys —
-- these tables were authored after `lint:section-policies` existed.

drop policy if exists maintenance_inspectors_select on maintenance_inspectors;
create policy maintenance_inspectors_select on maintenance_inspectors for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() in ('admin','fleet_manager','technician','auditor','accountant')));

drop policy if exists maintenance_inspectors_write on maintenance_inspectors;
create policy maintenance_inspectors_write on maintenance_inspectors for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')));

drop policy if exists maintenance_print_profiles_select on maintenance_print_profiles;
create policy maintenance_print_profiles_select on maintenance_print_profiles for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() in ('admin','fleet_manager','technician','auditor','accountant')));

drop policy if exists maintenance_print_profiles_write on maintenance_print_profiles;
create policy maintenance_print_profiles_write on maintenance_print_profiles for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')));

drop policy if exists vehicle_inspection_items_select on vehicle_inspection_items;
create policy vehicle_inspection_items_select on vehicle_inspection_items for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() in ('admin','fleet_manager','technician','auditor','accountant')));

drop policy if exists vehicle_inspection_items_write on vehicle_inspection_items;
create policy vehicle_inspection_items_write on vehicle_inspection_items for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')));

drop policy if exists vehicle_inspections_select on vehicle_inspections;
create policy vehicle_inspections_select on vehicle_inspections for select
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'view',
    auth_role() in ('admin','fleet_manager','technician','auditor','accountant')));

drop policy if exists vehicle_inspections_write on vehicle_inspections;
create policy vehicle_inspections_write on vehicle_inspections for all
  using (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')))
  with check (org_id = auth_org_id() and auth_section_or_default('maintenance', 'manage',
    auth_role() in ('admin','fleet_manager','technician')));
