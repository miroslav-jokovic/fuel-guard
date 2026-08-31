-- 0277 — the PostgREST half of splitting `fleet` into `roster` and `equipment`.
--
-- D-ROS12, docs/plans/roster/DRIVER-ROSTER-PLAN.md step R0a; owner ruling 2026-08-30 answering that
-- plan's §6 Q1. The TypeScript side of the split is packages/shared/src/auth.ts, whose header carries
-- the argument. This file is only the part the database has to be told.
--
-- ── WHY THIS FILE IS SHORT ──────────────────────────────────────────────────────────────────────
-- There is no `app_section` type in Postgres and never has been (`grep app_section` over every
-- migration returns nothing). Sections live in the TypeScript matrix and reach SQL only as the role
-- lists that 0078_role_department_rls.sql wrote out BY HAND, per table, from rolesThatManage(section)
-- at authoring time. So renaming a section touches SQL only where a policy's DERIVED LIST actually
-- changes value. Exactly two do.
--
-- ── THIS IS A REVOCATION, AND IT IS THE POINT ───────────────────────────────────────────────────
-- `safety_manager` LOSES PostgREST write on `vehicles` and `trailers`.
--
-- 0078 gave it to them because `rolesThatManage("fleet")` was ['admin','fleet_manager','safety_manager']
-- and `fleet` covered the trucks as well as the people. It was never a decision that a safety manager
-- should edit a tractor's plate or VIN; it was the blast radius of one word covering two things. The
-- split makes the sentence sayable — `roster: manage`, `equipment: view` — and this migration makes
-- the database agree with it.
--
-- Measured before writing, so the risk is stated rather than assumed: NO product path reaches this
-- capability today. Every write affordance in the web is gated on `session.canManage`, which is
-- `canManageFleet` = admin || fleet_manager, so a safety_manager has never been shown an edit button
-- on Vehicles or Trailers. What is being revoked is a grant that existed only for someone holding a
-- raw PostgREST token. (That divergence between the helper and the matrix is the defect the plan's
-- step R0 removes; this file is why R0 can then widen the roster without widening the equipment.)
--
-- ── WHAT DOES *NOT* CHANGE, AND WHY IT IS LISTED ────────────────────────────────────────────────
-- `drivers_write` keeps the list 0212 gave it: ('admin','fleet_manager','safety_manager','recruiter').
-- That is exactly rolesThatManage('roster') plus 0212's deliberate by-name recruiter carve-out, so
-- the split leaves it correct and re-issuing it would be noise. Stated here rather than left silent
-- because the next reader will come looking for it.
--
-- `driver_vehicle_assignments` and `driver_time_off` belong to `roster`, not `equipment` (owner
-- ruling, 2026-08-30). The close call is the assignment: it is PERFORMED from the Vehicles page,
-- which is the argument for `equipment`. It lands in `roster` because the sections are drawn on who
-- the row is ABOUT — the driver is the subject of the sentence and the truck is the object — and
-- because a section drawn on which screen edits a row would have to be redrawn every time a screen
-- moves, which is how `fleet` became two things in the first place. Neither table's policy names a
-- role today, so neither needs a statement here; the ruling is recorded for the reader who adds one.
--
-- Reads are untouched throughout. `vehicles_select` (0004:49) and `trailers_select` (0030:25) grant
-- select to every org member with no role test, which is why `equipment: view` costs no SQL — the
-- section governs the nav and the route guards, and the row filter was already org-scoped.

-- ── equipment: vehicles ─────────────────────────────────────────────────────────
-- rolesThatManage('equipment') = ['admin','fleet_manager'].
drop policy if exists vehicles_write on vehicles;
create policy vehicles_write on vehicles for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── equipment: trailers ─────────────────────────────────────────────────────────
drop policy if exists trailers_write on trailers;
create policy trailers_write on trailers for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));
