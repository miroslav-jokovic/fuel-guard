-- 0486 — the EFS card and statement tables are readable by the roles that hold the fuel section, and never
-- by a driver (EFS security audit 2026-10-15, finding 1).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- `fuel_cards_select` (0007), `efs_txn_select` (0011), `declined_select` (0007) and
-- `efs_processing_runs_select` (0154) are `org_id = auth_org_id()` and nothing more — verified in
-- `pg_policies` on production 2026-10-15. 0417 closed the same gap on `fuel_transactions` and left these
-- four, because the 2026-10-03 database audit measured only the ledger. What they hold is worse than the
-- ledger: `fuel_cards.card_ref`, `efs_transactions.card_num` and `declined_transactions.card_ref` carry the
-- FULL card number in clear (on 2026-10-15: 194 of 194 card rows, 320 distinct statement cards, 3,985
-- declines). So any member of the organisation — the driver and the technician included — could read every
-- card number of the fleet straight from PostgREST with the anon key and their own token, while the copy
-- the API keeps is sealed (0171 seals `efs_cards.card_number_sealed` for exactly this reason: "a SELECT
-- policy would hand both to every authenticated member of the org"). Rows of another organisation: 0 — the
-- wall between tenants holds; this is the wall between sections, and between the office and the cab.
--
-- ── WHAT IT DOES ────────────────────────────────────────────────────────────────────────────────
-- One RESTRICTIVE select policy per table, the shape of 0417's `ftxn_section_read`: the caller must hold
-- the fuel section at VIEW level, answered through `auth_section_or_default` so an organisation's override
-- reaches it (a role the org has granted fuel gets in, one it has revoked is refused, the admin cannot be
-- narrowed, D-PERM7). The default list is `rolesThatCanView("fuel")`, which `lint:section-policies` checks.
-- Unlike 0417 there is NO driver branch. The ledger holds a driver's own fills; these tables hold no row
-- a driver needs (the driver app reads none of them — read from apps/driver 2026-10-15). A driver is then
-- refused by the helper itself, which pins `driver` to its shipped default and ignores any override
-- (0292, D-PERM7) — so a fuel grant in a driver's token cannot open the fleet's cards, and the matrix
-- asserts exactly that rather than this file restating it.
-- RESTRICTIVE, not a replacement, because permissive policies combine with OR: a second permissive policy
-- could only ever add access.
--
-- ── WHAT ELSE CHANGES WITHOUT BEING EDITED ──────────────────────────────────────────────────────
-- `efs_transaction_facets` (0313) and `decline_facets` (0314) are SECURITY INVOKER and called from the
-- Fuel Log with the user's token, so they now return nothing to a role without the section — which is
-- the only kind of caller the page's own gate (`fuel.log`, `section("fuel")` in surfaceCatalogue.ts) lets
-- reach them. Every other reader of these tables is the API through the service role, which bypasses
-- row-level security, so the dashboard, scoring, reconciliation and the card-fraud pipeline are unaffected.
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────────────────────────
-- · A fuel VIEWER still reads full card numbers. That is the second step of the finding: the columns keep
--   the last four (or six, what a statement prints) plus a keyed hash for matching, and the full number
--   lives only sealed. It needs new columns, then their readers, then the clear columns emptied — three
--   merges by `lint:migration-ordering`, recorded in docs/plans/fuel/CARD-NUMBER-AT-REST-PLAN.md.
-- · The browser WRITE policies on these tables (`fuel_cards_write`, `efs_txn_write`, `declined_write`) are
--   untouched; they already require fuel `manage`.
--
-- cross-module-waiver: one finding across the fuel and efs modules' tables — the same card number in clear
-- in both, closed by the same policy, so splitting it would leave one module's copy readable for a release.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- A policy, no column, no function body. Every page that reads these tables is already gated on the fuel
-- section, so a request reaching the old or the new policy gets an answer its page expects.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- drop policy fuel_cards_section_read on public.fuel_cards;
-- drop policy efs_txn_section_read on public.efs_transactions;
-- drop policy declined_section_read on public.declined_transactions;
-- drop policy efs_processing_runs_section_read on public.efs_processing_runs;
--
-- ── VERIFY AFTER IT APPLIES ─────────────────────────────────────────────────────────────────────
--   select tablename, policyname, permissive from pg_policies where cmd = 'SELECT' and tablename in
--     ('fuel_cards','efs_transactions','declined_transactions','efs_processing_runs') order by 1, 2;
--   -- expect one RESTRICTIVE *_section_read beside each table's permissive select policy.

drop policy if exists fuel_cards_section_read on public.fuel_cards;
create policy fuel_cards_section_read on public.fuel_cards
  as restrictive
  for select
  using (
    auth_section_or_default('fuel', 'view',
      auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager', 'auditor', 'accountant'))
  );

drop policy if exists efs_txn_section_read on public.efs_transactions;
create policy efs_txn_section_read on public.efs_transactions
  as restrictive
  for select
  using (
    auth_section_or_default('fuel', 'view',
      auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager', 'auditor', 'accountant'))
  );

drop policy if exists declined_section_read on public.declined_transactions;
create policy declined_section_read on public.declined_transactions
  as restrictive
  for select
  using (
    auth_section_or_default('fuel', 'view',
      auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager', 'auditor', 'accountant'))
  );

drop policy if exists efs_processing_runs_section_read on public.efs_processing_runs;
create policy efs_processing_runs_section_read on public.efs_processing_runs
  as restrictive
  for select
  using (
    auth_section_or_default('fuel', 'view',
      auth_role() in ('admin', 'fleet_manager', 'dispatcher', 'safety_manager', 'auditor', 'accountant'))
  );
