-- 0417 — the fuel ledger is readable by the roles that hold the fuel section, not by every member of the
-- organisation (database audit 2026-10-03, finding 1, the `fuel_transactions` half).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- `ftxn_select` (0004) is `org_id = auth_org_id()` and nothing more, and 0396 moved the WRITE policies
-- onto the section helpers while leaving this one. So the section a role holds decides what the screens
-- and the API show it, and decides nothing about what PostgREST returns. Measured on production
-- 2026-10-03 by role simulation inside a transaction that was rolled back: an authenticated
-- `fleet_manager` whose organisation had set fuel, roster and loads to `none` read 17,753 fuel rows (and
-- 292 driver rows); `fuel_range_totals`, a SECURITY INVOKER function, reported `fills = 17,753` for the
-- same caller because it inherits the table's policy. Rows of another organisation: 0 — the wall between
-- tenants holds, this is the wall between SECTIONS inside one.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────────────────────────
-- One RESTRICTIVE policy for SELECT: a driver passes (their own rows are still limited to themselves by
-- the driver-scope policies already on the table), everyone else must hold the fuel section at VIEW
-- level, answered through `auth_section_or_default` so an organisation's override reaches it — a role
-- the org has granted fuel gets in, one it has revoked is refused, and the admin cannot be narrowed
-- (D-PERM7). The default list is `rolesThatCanView("fuel")`, which `lint:section-policies` checks.
-- RESTRICTIVE, not a replacement: permissive policies combine with OR, so a second permissive policy
-- could only ever ADD access, and the audit's own fix note says as much. This follows 0209's
-- `driver_employment_history_section_read`.
-- View, not manage, because the screens that read this table are view screens: dispatcher, safety
-- manager, auditor and accountant read fuel without managing it.
--
-- ── WHAT ELSE CHANGES WITHOUT BEING EDITED ──────────────────────────────────────────────────────
-- Four SECURITY INVOKER functions are called from the browser with the user's token and read this table:
-- `fuel_range_totals`, `fuel_range_miles_inputs`, `fuel_buy_fills`, `fuel_spend_lines`. They now return
-- nothing to a role without the section, instead of the whole organisation's ledger. Six more
-- (`dashboard_summary`, `ifta_period_jurisdictions`, `telematics_coverage_buckets`,
-- `sample_clear_transactions`, `merge_driver`, `merge_driver_v2`) read it too, but every caller is the
-- API through the service role, which bypasses row-level security — read from the call sites 2026-10-03,
-- the browser calls none of them — so the dashboard is NOT affected and keeps its own role gating.
--
-- ── WHAT MUST HAVE SHIPPED FIRST, AND DID ───────────────────────────────────────────────────────
-- Three pages read this table for roles that do not hold the section. #1239 switched the vehicle and
-- driver detail pages' fuel queries off for them, and #1240 moved the Odometer screen from the equipment
-- gate to fuel. Without those a technician or recruiter would have met an EMPTY fills panel, which reads
-- as "this truck has never been fuelled" — a wrong answer where there had been a leak. Check before
-- merging this that both are served (`pnpm verify:live`).
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────────────────────
-- · `drivers` is not touched. Driver NAMES are needed by roles with no roster section (an accountant reads
--   fuel lines by driver; the idling and performance pages list names), so gating the row by roster would
--   blank those screens. It needs a name-only surface first — its own migration.
-- · `anomalies`, `fuel_exceptions` and the other fuel-module tables keep their own policies; this is the
--   one table the audit proved and the one the four RPCs read.
-- · It does not stop a stale token (finding 3): section and role come from the JWT, as everywhere here.
-- · Three pages are gated by a section that implies fuel under the SHIPPED matrix but need not under an
--   organisation's override: /anomalies and /idling (safety) and the two coverage screens (settings) read
--   this table. An org that grants safety without fuel would see them empty. Recorded as Q-DA2 in
--   docs/plans/permissions/DATABASE-AUDIT-2026-10-03-PLAN.md, not patched inside the pages.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- A policy, no column, no function body. The code that needed to change is already served, so a request
-- reaching the old or the new policy gets an answer its page expects. The change IS visible to a user:
-- a role without fuel that used to read the ledger directly from PostgREST with its own token now gets
-- nothing.
-- That is the point.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- `drop policy ftxn_section_read on public.fuel_transactions;`
--
-- ── VERIFY AFTER IT APPLIES ─────────────────────────────────────────────────────────────────────
--   select policyname, permissive, cmd from pg_policies where tablename = 'fuel_transactions' and cmd = 'SELECT';
--   -- expect ftxn_section_read RESTRICTIVE beside ftxn_select. Then, in a DO block that raises so nothing
--   -- persists: set local role authenticated, claims for a fleet_manager with sections {"fuel":"none"} →
--   -- count(*) 0; the same claims with no override → the organisation's rows.

drop policy if exists ftxn_section_read on public.fuel_transactions;

create policy ftxn_section_read on public.fuel_transactions
  as restrictive
  for select
  using (
    auth_role() = 'driver'
    or auth_section_or_default('fuel', 'view',
         auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager', 'auditor', 'accountant'))
  );
