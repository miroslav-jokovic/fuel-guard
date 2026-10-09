-- 0444: a fill's business date is the day EFS prints, on EFS's Central clock — Q-F5, chunk 10a of
-- docs/plans/product-readiness/F02-F04-fuel-transactions-and-findings/PLAN.md.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT IS WRONG, MEASURED
--
-- 0287 (D-FUI11) stored `business_date` as the STATION's local day and called it "the day EFS prints".
-- EFS does not print the station's day. Its guide: "All our servers are central time" (p. 10); the
-- reject report's `tranDate` is "Central Time zone" (p. 107); `serverTime` is "based on the Central Time
-- zone" (p. 133). Measured on production 2026-10-07, 08-01 → 10-05:
--
--     (fueled_at at time zone 'America/Chicago')::date = EFS's tran_date      4,601 of 4,601 fills
--     today's business_date (the station's day)        ≠ EFS's tran_date          42
--
-- and, re-measured read-only 2026-10-08 over the whole table: 129 of 18,494 fills carry a different
-- day under the station rule than under EFS's, 01-04 → 10-07. Every one is an evening fill west of
-- Central, so the Fuel Log filed it a day before the statement it is billed on — and a month before it
-- when the evening was the last of the month.
--
-- So this carries out D-FUI11's stated intent rather than reversing it. The station's own clock time
-- is not lost: it is still what the Fuel Log's hover shows (F-H2), and `fueled_at` is the instant.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- THE SHAPE
--
-- · `efs_clock_tz()` names the zone. It is EFS's clock, NOT the carrier's: a carrier based in Denver
--   buying through EFS is still billed on Central days, so this is not an org setting and must never
--   be read as one. A second fuel vendor with its own clock gets its own function.
--
-- · `fuel_business_date(timestamptz, text)` keeps its signature and stops reading `p_state`. Five
--   functions call it by that signature (0254, 0256, 0258 ×2, 0405's `fuel_spend_lines`), and changing it
--   would mean recreating each of them to delete one argument that now does nothing. The argument stays,
--   unused, and says so below. `fuel_station_tz` is untouched: the hover and the after-hours rule still
--   need the station's zone, which is a different question from which day the bill is on.
--
-- · Neither function gets `set search_path` (D-FI1, 0248): both are per-row scalars, and a `SET` blocks
--   inlining — 128× per row, measured, and the spend report times out. They touch no tables, and the one
--   non-builtin call is schema-qualified, which is the property the `SET` stands in for.
--
-- · `efs_clock_tz()` is granted to `authenticated` because `fuel_business_date` is (0412 closes a new
--   function by default), and an inlined call still checks EXECUTE on the function it inlines.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- THE BACKFILL, AND WHAT IT DOES NOT DO
--
-- Only the rows whose day changes are written (129 on production), with the same two triggers muted
-- that 0287 muted and for its reasons: `trg_ftxn_updated` would stamp a recompute of a derived column
-- as a modification of the fill, and `trg_fuel_txn_satellites` would re-write up to three satellite
-- rows per fill for a column none of them mirrors. `trg_ftxn_business_date` stays on and computes the
-- same answer the statement sets, so re-running this file is harmless.
--
-- Every SQL reader follows without a change: `fuel_spend_lines`, `fuel_report_days`, the IFTA and buy
-- reads call `fuel_business_date`, and 0289/0290/0297/0312 read the stored column.
--
-- ⚠ `fuel_spend_days` does NOT follow on its own. It is derived in TypeScript (`rollupDerive.ts`), which
-- until this PR worked the day out again from the station's state — a second copy of the rule. This PR
-- makes it read the stored `business_date`, and a migration cannot run that code, so after the release
-- that carries this file the spend days are rebuilt once with the audited `POST /api/fuel/spend-rollup`
-- over 2026-02-04 (the table's first day) → today. Until then the nightly sweep corrects the last
-- fourteen days only. The rebuild is recorded in the plan's Log when done.
--
-- Proven in supabase/tests/fuel-business-date-efs-clock.test.mjs.
--
-- Rollback: recreate 0248's `fuel_business_date` body in a new migration and re-run this backfill
-- statement; no row is deleted, and the stored day is derived, so nothing is lost either way.

-- ── EFS's clock ─────────────────────────────────────────────────────────────────────────────────
create or replace function efs_clock_tz()
returns text
language sql
immutable
parallel safe
as $$
  select 'America/Chicago'::text;
$$;

comment on function efs_clock_tz() is
  'The zone EFS''s servers keep time in (guide p. 10, "All our servers are central time"). EFS''s clock, '
  'not the carrier''s — never an org setting (0444, Q-F5).';

-- ── the day a fill is billed on ─────────────────────────────────────────────────────────────────
-- ⚠ Do NOT add `set search_path` (D-FI1, 0248). `public.` on the inner call is what makes that safe.
-- `p_state` is accepted and ignored: kept so the five callers keep their signature (see the header).
create or replace function fuel_business_date(p_fueled_at timestamptz, p_state text)
returns date
language sql
stable
parallel safe
as $$
  select (p_fueled_at at time zone public.efs_clock_tz())::date;
$$;

comment on function fuel_business_date(timestamptz, text) is
  'The day EFS prints for a fill: its instant on EFS''s Central clock (0444, Q-F5). p_state is unused '
  'since 0444 and kept only so callers keep their signature.';

comment on column fuel_transactions.business_date is
  'The day EFS prints, on EFS''s Central clock (0444, Q-F5; was station-local under 0287). DERIVED by '
  'trg_ftxn_business_date — no writer can assert it.';

revoke all on function efs_clock_tz() from public, anon, authenticated;
revoke all on function fuel_business_date(timestamptz, text) from public, anon;
grant execute on function efs_clock_tz() to authenticated, service_role;
grant execute on function fuel_business_date(timestamptz, text) to authenticated, service_role;

-- ── backfill the fills whose day moves ──────────────────────────────────────────────────────────
alter table fuel_transactions disable trigger trg_ftxn_updated;
alter table fuel_transactions disable trigger trg_fuel_txn_satellites;

update fuel_transactions
   set business_date = fuel_business_date(fueled_at, state)
 where business_date is distinct from fuel_business_date(fueled_at, state);

alter table fuel_transactions enable trigger trg_fuel_txn_satellites;
alter table fuel_transactions enable trigger trg_ftxn_updated;
