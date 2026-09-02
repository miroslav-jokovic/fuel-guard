-- 0294 — the override reaches the database: fuel and safety.
--
-- D-PERM3/D-PERM4, docs/plans/permissions/EDITABLE-PERMISSIONS-PLAN.md step P4, batch 2 of 3.
-- 0293 did dispatch, hazmat, roster and equipment with the `auth_section_or_default()` helper it
-- introduced; this applies the same one predicate change to the fuel and safety sections.
--
-- ── WHAT THIS BATCH IS, COUNTED ────────────────────────────────────────────────────────────────
-- The plan's §2b inventory sized this batch at 21 (fuel 12 + safety 9), counted mechanically as
-- "policies carrying a role list on a table whose module maps to an editable section". Re-derived
-- against the matrix itself — comparing each policy's list to `rolesThatManage`/`rolesThatCanView`
-- for its section — 13 of those 21 are section gates and 8 are not. This migration wraps the 13.
-- The other 8 are named below with the reason each is excluded, because an exclusion nobody wrote
-- down is indistinguishable from an omission.
--
--   fuel     9 wrapped, 3 excluded (drift, see below)
--   safety   4 wrapped, 5 excluded (4 regulatory reader tests + 1 that is a recruitment gate)
--
-- ── THE FOUR REGULATORY READER TESTS, WHICH ARE NOT AN ORG'S TO EDIT ───────────────────────────
-- `documents_restricted_testing`, `documents_restricted_investigation`,
-- `qualification_records_restricted_testing` and `qualification_records_restricted_investigation`
-- carry role lists, sit on safety-section tables, and are NOT section gates. 0211's header says so
-- in words and the matrix says so in arithmetic: their lists are ['admin','safety_manager'] and
-- ['admin','safety_manager','recruiter'], and neither equals safety's manage set
-- (admin, fleet_manager, safety_manager) or its view set (those three plus auditor). They mirror
-- `canReadTestingRecords()` and `canReadInvestigationHistory()` in packages/shared/src/auth.ts, not
-- `SECTION_ACCESS`, because they implement two federal rules rather than a product section:
--
--   §382.401(a)   — drug and alcohol testing records live in "a secure location with controlled
--                   access". A custody rule.
--   §391.53(a)(1) — the investigation history goes to "those who are involved in the hiring
--                   decision", which is what puts the recruiter in the second list and not the first.
--
-- Wrapping these would make a federal confidentiality rule org-editable: an org that granted
-- `safety: manage` to its dispatchers would thereby hand them drug-test results. They stay bare role
-- checks, exactly as the plan's B3 note already ruled for the PSP gates, and D-PERM9 (added to the
-- plan with this migration) records that as a decision rather than an oversight.
--
-- ── THREE FUEL POLICIES LEFT ALONE, BECAUSE THEY DISAGREE WITH THE MATRIX TODAY ────────────────
-- `fuel_discount_write` and `route_fuel_settings_write` both list ['admin','dispatcher',
-- 'fleet_manager']; `ftxn_insert` lists ['admin','driver','fleet_manager']. Fuel's manage set is
-- ['admin','fleet_manager'] — a dispatcher holds `fuel: view`. So these three are pre-existing drift
-- between SQL and `SECTION_ACCESS`, not section gates that merely need a wrapper.
--
-- They are NOT wrapped here, and the reason is the gate rather than taste. `lint:section-policies`
-- would reject their lists, and its only escape hatch is the waiver marker that
-- check-section-policies.mjs greps for — which is FILE-scoped, so adding one to buy three policies
-- would switch the gate off for the other thirteen and leave this migration looking checked while
-- checking nothing. (That is not hypothetical: an earlier draft of THIS header quoted the marker
-- verbatim as prose and thereby waived its own migration; the gate reported "ok" and read none of
-- the 26 role lists below. It is grepped out of the raw file, before comments are stripped.)
-- Splitting the three into a waived file of their own would work mechanically, but wrapping a list
-- the matrix contradicts would freeze the drift as "the shipped default" under D-PERM4, which is the
-- one thing that plan section says the role list must never become. The drift is real work and it is recorded as Q-PERM10 in the plan
-- with its candidate answers measured (both dispatcher lists are exactly
-- `rolesThatManage('dispatch')`, and the discount-rules API path has already moved to
-- `requireSection("admin")` — see apps/api/src/modules/fuel/routes/discountRules.ts).
--
-- ── `psp_requests_section_read` MOVES TO BATCH 3 ───────────────────────────────────────────────
-- Its list is ['admin','fleet_manager','safety_manager','auditor','recruiter'], which is exactly
-- `rolesThatCanView('recruitment')` and not any safety set — and 0216's own header calls it "hiring
-- paperwork, behind the hiring section". It reaches this batch only because the `psp` MODULE maps to
-- `safety` in check-section-policies.mjs, and module ownership answers a different question from
-- section membership (that script's TABLE_SECTIONS comment makes the distinction). Wrapping it needs
-- a `TABLE_SECTIONS` entry pointing `psp_requests` at `recruitment`, which belongs with the rest of
-- the recruitment section in batch 3 rather than smuggled in here.
--
-- ── WHY WRAPPING AN APPEND-ONLY TABLE CHANGES NOTHING ABOUT ITS APPEND-ONLY-NESS ───────────────
-- `certifications`, `documents`, `qualification_records` and `dq_exports` are pinned in
-- `RETENTION_FORBIDDEN` (apps/api/src/modules/org/dataRetention.ts), as are the fuel tables
-- `anomalies`, `declined_transactions`, `efs_transactions` and `fuel_transactions`. That list governs
-- which tables a RETENTION PRUNE may ever name, and it is enforced by a guard test over
-- `RETENTION_RULES` — a different mechanism at a different layer from RLS. Nothing below adds,
-- removes or narrows a delete path: each policy keeps the command it already had, and the three
-- INSERT/SELECT policies here cannot express a deletion at all. An org narrowing its safety section
-- makes fewer people able to file evidence; it does not make anybody able to destroy it.
--
-- ── WHY APPLYING THIS CHANGES NOTHING TODAY ────────────────────────────────────────────────────
-- Unchanged from 0293: no `org_section_access` row exists in production, so no token carries a
-- `sections` claim, so `auth_section()` returns null for every caller and every policy below takes
-- its default branch. The evidence is the existing matrices passing UNCHANGED, quoted in the PR.
--
-- ── SPELLING: `in (...)` RATHER THAN `= any (array[...])` ──────────────────────────────────────
-- 0293 wrote its role lists as `auth_role() = any (array[...])`. Postgres renders both spellings
-- identically in `pg_policy` — the regenerated schema below is byte-identical either way — but
-- `check-section-policies.mjs` detects a role list with /auth_role\(\)\s+in\s+\(/, so 0293's 31 lists
-- were not in fact checked against auth.ts by the gate the plan credits for checking them. Batch 2
-- uses the spelling the gate reads, and the same commit teaches the detector the other spelling so
-- 0293 is checked retroactively and neither spelling can go blind again.
--
-- cross-module-waiver: this migration is ONE predicate change applied identically to every policy
-- that asks a section question, and the sections it covers do not line up with module boundaries —
-- `fuel` alone spans the efs, fuel, fuel-spend, anomalies and routing modules, and `safety` spans
-- evidence and psp. Splitting by module would produce six migrations performing the same mechanical
-- edit, multiplying the review surface without separating anything a reviewer wants separated;
-- batching by SECTION is what makes each PR's blast radius one capability, and the matrices are
-- grouped the same way. 0293 carried this waiver for the same reason and batch 3 will too.
--
-- Rollback: re-create each policy below with its bare `auth_role() in (...)` predicate.

-- ── fuel (9) ────────────────────────────────────────────────────────────────────────────────────
-- Fuel's manage set is ['admin','fleet_manager'] for every one of these; the variety in this section
-- is in the tables, not the lists.

drop policy if exists anomalies_update on anomalies;
create policy anomalies_update on anomalies for update
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

drop policy if exists declined_write on declined_transactions;
create policy declined_write on declined_transactions for all
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

drop policy if exists efs_txn_write on efs_transactions;
create policy efs_txn_write on efs_transactions for all
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

drop policy if exists fuel_cards_write on fuel_cards;
create policy fuel_cards_write on fuel_cards for all
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

-- `fuel_transactions` has three separate policies by command; `ftxn_insert` is the third and is NOT
-- touched here — see the drift note above.
drop policy if exists ftxn_delete on fuel_transactions;
create policy ftxn_delete on fuel_transactions for delete
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

drop policy if exists ftxn_update on fuel_transactions;
create policy ftxn_update on fuel_transactions for update
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

drop policy if exists import_rows_write on import_rows;
create policy import_rows_write on import_rows for all
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

drop policy if exists imports_write on imports;
create policy imports_write on imports for all
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

drop policy if exists sgl_write on station_geocode_learned;
create policy sgl_write on station_geocode_learned for all
  using (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('fuel', 'manage',
    auth_role() in ('admin','fleet_manager')));

-- ── safety (4) ──────────────────────────────────────────────────────────────────────────────────
-- Safety's manage set is ['admin','fleet_manager','safety_manager']; its view set adds the auditor,
-- which is why `dq_exports_select` is the one 'view' in this batch.

drop policy if exists certifications_write on certifications;
create policy certifications_write on certifications for all
  using (org_id = auth_org_id() and auth_section_or_default('safety', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager')))
  with check (org_id = auth_org_id() and auth_section_or_default('safety', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager')));

drop policy if exists documents_insert on documents;
create policy documents_insert on documents for insert
  with check (org_id = auth_org_id() and auth_section_or_default('safety', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager')));

drop policy if exists qualification_records_insert on qualification_records;
create policy qualification_records_insert on qualification_records for insert
  with check (org_id = auth_org_id() and auth_section_or_default('safety', 'manage',
    auth_role() in ('admin','fleet_manager','safety_manager')));

-- The one SELECT in this batch, so the one that asks for 'view' rather than 'manage'. `dq_exports`
-- has no client write policy at all (service-role writes only, per its table comment), so this is
-- the whole of an org's editable surface on the DQ export ledger.
drop policy if exists dq_exports_select on dq_exports;
create policy dq_exports_select on dq_exports for select
  using (org_id = auth_org_id() and auth_section_or_default('safety', 'view',
    auth_role() in ('admin','fleet_manager','safety_manager','auditor')));
