-- 0300 — every section policy's default branch now agrees with the matrix, or says by name why not.
--
-- EDITABLE-PERMISSIONS-PLAN.md step P6; answers Q-PERM10 and Q-PERM11 and SURFACE-ENTITLEMENTS-PLAN.md
-- Q-SURF8. Rulings D-PERM10 through D-PERM13, recorded in the plan and applied here.
--
-- ── WHAT WAS WRONG, MEASURED LIVE ON 2026-09-03 ────────────────────────────────────────────────
-- Under D-PERM4 a policy's role list IS the shipped default: the answer every org gets until it writes
-- an override row. `lint:section-policies` was supposed to hold each list equal to the matrix in
-- `packages/shared/src/auth.ts`, but it read only the `auth_role() in (...)` spelling and 0293 wrote
-- its 17 lists as `auth_role() = any (array[...])`, so 0293 was never checked (Q-PERM11). Reading
-- `pg_policies` on production found ELEVEN policies whose list is not the derived set of the section
-- they are wrapped in. For eight of them the page an admin now uses (S6/S8) shows a default the
-- database refuses — "HazmatGuard: Manage" for a safety manager, say — and the admin cannot repair it,
-- because `PUT /api/section-access` deletes the row when the value equals the shipped default, so
-- choosing the value already displayed writes nothing (Q-SURF8).
--
-- ── THE METHOD: EVERY RULING IS A MEASUREMENT, NOT A PREFERENCE ────────────────────────────────
-- For each policy, three facts were read before anything was decided: who WRITES the table through
-- PostgREST (the only path RLS governs — the API writes with the service role and bypasses it), what
-- the API's own gate for the same act derives from, and whether a migration or auth.ts already
-- explains the difference. That sorts the eleven into four cases:
--
--   A. The list is a dead path and the API already derives from the matrix.
--      No client code writes hazmat_loads, hazmat_documents, driver_vehicle_assignments,
--      driver_scores or driver_performance_weeks (measured: zero `.from("<table>")` writes in apps/web
--      and apps/driver). The API gates loads and documents with `requireSection("hazmat")` and the
--      roster acts with the roster section, both of which INCLUDE the safety manager. So the SQL list
--      protects nothing today and merely disagrees with what the API enforces. → align to the matrix.
--      Behaviour change for a claim-less token: a safety manager may now do through PostgREST what
--      the API already lets them do. Nothing a person can reach today stops working.
--
--   B. The list is a NAMED grant, and the section is the wrong unit for it (D-PERM10).
--      `hazmat_reviews` — HAZMAT_REVIEW_ROLES in shared (D6, separation of duties: dispatchers create
--      loads, they do not clear them). The API's review route is `requireRole(...HAZMAT_REVIEW_ROLES)`
--      and does not consult the section either; hazmat_rls.test.mjs pins "dispatcher CANNOT read
--      reviews". `drivers_write` — the recruiter's single roster write, granted by NAME in 0212 so a
--      hire can be recorded without widening the roster section (auth.ts says so). → the review
--      policies lose the section wrapper (an org's hazmat override must not be able to widen who
--      clears a load, exactly as it cannot at the API), drivers_write keeps it, and all three carry
--      a per-policy waiver naming the grant. Same class as D-PERM9's regulatory reader tests.
--
--   C. The list is right and the SECTION is wrong (D-PERM11): a table belongs to the section whose
--      page edits it. `idle_settings` is written from the Idling page (`useAdoptComfortBand`,
--      features/idle) — a `safety` surface — and its list is exactly rolesThatManage('safety'); it was
--      wrapped in `equipment` because its MODULE is `idle`. `route_fuel_settings` is written from Fuel
--      Planning (`useSaveRouteFuelSettings`) — a `dispatch` surface — and `fuel_discount_rules` is read
--      by the same planner; both lists are exactly rolesThatManage('dispatch'), which Q-PERM10 had
--      already noticed. → re-wrap under the section the list derives from, list unchanged, and add
--      the three to TABLE_SECTIONS in the gate. No behaviour change for any token.
--
--   D. A role a RESTRICTIVE policy already refuses is dead text in a permissive list (D-PERM12).
--      `ftxn_insert` lists [admin, fleet_manager, driver]. The office half is rolesThatManage('fuel').
--      The `driver` has been unreachable since 0135 closed the driver's PostgREST fill-up with a
--      RESTRICTIVE `fuel_tx_driver_insert` (`auth_role() <> 'driver'`) — the driver app records fuel
--      through the API, and a restrictive policy AND-combines with this one, so the listed role could
--      never pass. → the dead role is removed and the policy becomes the fuel section's manage
--      question, which the same-table `ftxn_update` and `ftxn_delete` already are (0294). Same
--      answer for every token, and the matrix pins the driver's refusal so the closure cannot be
--      undone by accident here.
--
-- ── WHY THE GATE CHANGES IN THE SAME PR (D-PERM13) ─────────────────────────────────────────────
-- Un-blinding the detector to the second spelling makes it read 0293, which cannot be edited. So the
-- gate now checks the LATEST definition of each (table, policy) across migrations above the boundary
-- — a superseded `create policy` is dead text — and waivers are per policy
-- (`-- section-policy-waiver(<policy>): <reason>`) on their own line, so a header that merely mentions
-- the marker no longer waives its whole file. That is the trap 0294's header paid for.
--
-- ── WHY APPLYING THIS IS SAFE IN THE DEPLOY WINDOW ─────────────────────────────────────────────
-- Policies only; no TypeScript reads anything new. Every widening below is one the API already
-- grants, every re-wrap keeps its list, and the three named grants keep their exact lists. The
-- matrices (`hazmat_rls`, `org-section-access`, `rls`) assert the claim-less answers and the override
-- answers for every policy here, and the schema snapshot shows the net change in one hunk.
--
-- cross-module-waiver: one ruling applied to eleven policies in six modules (hazmat, roster,
-- performance, idle, fuel, routing). Batching by module would be six migrations performing the same
-- mechanical edit, for the reason 0293 gave; batching by RULING is what makes this reviewable as one.
--
-- Rollback: re-create each policy with the predicate it carried before (0293 for the wrapped ones,
-- 0078 for fuel_discount_write and route_fuel_settings_write, 0004 for ftxn_insert).

-- ── A. Align to the matrix: hazmat management and the three roster tables ───────────────────────
-- hazmat manage = admin, fleet_manager, dispatcher, safety_manager.
drop policy if exists hazmat_loads_manager_insert on hazmat_loads;
create policy hazmat_loads_manager_insert on hazmat_loads for insert
  with check (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager')));

drop policy if exists hazmat_loads_manager_update on hazmat_loads;
create policy hazmat_loads_manager_update on hazmat_loads for update
  using (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager')));

drop policy if exists hazmat_documents_manager_insert on hazmat_documents;
create policy hazmat_documents_manager_insert on hazmat_documents for insert
  with check (org_id = auth_org_id() and auth_section_or_default('hazmat', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager')));

-- roster manage = admin, fleet_manager, safety_manager (D-ROS12; the owner's 2026-08-30 ruling put
-- driver_vehicle_assignments in roster because the driver is the subject of the sentence).
drop policy if exists dva_write on driver_vehicle_assignments;
create policy dva_write on driver_vehicle_assignments for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')));

drop policy if exists driver_scores_write on driver_scores;
create policy driver_scores_write on driver_scores for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')));

drop policy if exists dpw_write on driver_performance_weeks;
create policy dpw_write on driver_performance_weeks for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')));

-- ── B. Named grants (D-PERM10) ──────────────────────────────────────────────────────────────────
-- A review is signed by one of HAZMAT_REVIEW_ROLES and by nobody an org adds to `hazmat: manage`;
-- the wrapper 0293 put here would have let a section override widen who clears a load, which the
-- API's `requireRole(...HAZMAT_REVIEW_ROLES)` never allows. `reviewer_id = auth_user_id()` stays.
-- section-policy-waiver(hazmat_reviews_insert): HAZMAT_REVIEW_ROLES, granted by name — D6 separation of duties, shared/hazmatApi.ts
drop policy if exists hazmat_reviews_insert on hazmat_reviews;
create policy hazmat_reviews_insert on hazmat_reviews for insert
  with check (org_id = auth_org_id()
    and auth_role() in ('admin', 'fleet_manager', 'safety_manager')
    and reviewer_id = auth_user_id());

-- The readers are the reviewers plus the auditor. A dispatcher reads the LOAD's status, which is
-- where a cleared review lands; hazmat_rls.test.mjs pins "dispatcher CANNOT read reviews".
-- section-policy-waiver(hazmat_reviews_select): HAZMAT_REVIEW_ROLES plus the auditor, granted by name — the review record is the clearing act's evidence, not the load
drop policy if exists hazmat_reviews_select on hazmat_reviews;
create policy hazmat_reviews_select on hazmat_reviews for select
  using (org_id = auth_org_id()
    and auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'auditor'));

-- Re-created identically so the waiver sits beside the definition the gate reads. The recruiter's
-- roster write is granted by NAME in 0212 (a hire needs a drivers row, and widening the roster
-- section to get one would hand the recruiter every driver's file — the leak `recruitment` exists to
-- prevent). The section wrapper stays: an org that narrows `roster` narrows this too.
-- section-policy-waiver(drivers_write): rolesThatManage('roster') plus the recruiter by name — 0212, auth.ts "granted by NAME in 0212's policy rather than by widening the section"
drop policy if exists drivers_write on drivers;
create policy drivers_write on drivers for all
  using (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'recruiter')))
  with check (org_id = auth_org_id() and auth_section_or_default('roster', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager', 'recruiter')));

-- ── C. The list was right and the section was wrong (D-PERM11) ──────────────────────────────────
-- idle_settings: edited from the Idling page, a safety surface. safety manage = admin, fleet_manager,
-- safety_manager — the list 0293 wrapped under `equipment`, whose manage set has no safety manager.
drop policy if exists idle_settings_write on idle_settings;
create policy idle_settings_write on idle_settings for all
  using (org_id = auth_org_id() and auth_section_or_default('safety', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('safety', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'safety_manager')));

-- fuel_discount_rules and route_fuel_settings: the fuel planner's inputs, edited from Fuel Planning, a
-- dispatch surface. dispatch manage = admin, fleet_manager, dispatcher — the list 0078 wrote.
drop policy if exists fuel_discount_write on fuel_discount_rules;
create policy fuel_discount_write on fuel_discount_rules for all
  using (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher')))
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher')));

drop policy if exists route_fuel_settings_write on route_fuel_settings;
create policy route_fuel_settings_write on route_fuel_settings for all
  using (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher')))
  with check (org_id = auth_org_id() and auth_section_or_default('dispatch', 'manage',
    auth_role() in ('admin', 'fleet_manager', 'dispatcher')));

-- ── D. The dead role comes out (D-PERM12) ───────────────────────────────────────────────────────
-- fuel manage = admin, fleet_manager. 0135's restrictive `fuel_tx_driver_insert` has refused every
-- driver insert here since it shipped; listing `driver` beside the office roles described a path that
-- does not exist. The shape is now the one `ftxn_update` and `ftxn_delete` took in 0294.
drop policy if exists ftxn_insert on fuel_transactions;
create policy ftxn_insert on fuel_transactions for insert
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin', 'fleet_manager')));
