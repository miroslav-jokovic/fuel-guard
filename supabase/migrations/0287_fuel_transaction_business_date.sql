-- 0287: the fill carries the DAY IT HAPPENED WHERE IT HAPPENED, as a column, maintained by trigger
--
-- FUEL-T1, merge 1 of 2 (docs/plans/fuel/FUEL-SECTION-CONSOLIDATION-PLAN.md). This migration adds and
-- fills the column and nothing reads it; the readers move in the next merge, because a merge is served
-- ~9 minutes before its migration is applied (docs/MIGRATION-DISCIPLINE.md §the-deploy-window,
-- `lint:migration-ordering`).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT IS WRONG TODAY, MEASURED IN PRODUCTION 2026-09-01
--
-- `fueled_at` is a true UTC instant. The Fuel Log RENDERS it in the station's zone (`stationDateTime`
-- over `stateTimeZone`) and FILTERS it as a bare string Postgres reads as UTC. So the date a reader
-- sees and the date the filter uses are two different derivations of the same row, and they disagree
-- whenever the station's local day differs from the UTC day — which is most evening fills west of
-- Greenwich.
--
--   canonical fills, 2026-01-01 → 2026-09-01                                   14,749
--   ...whose station-local business date ≠ their UTC date            1,833  (12.4%)
--   ...that a MONTH-boundary filter therefore puts in the wrong month    57  ($28,430.70)
--
-- ⚠ The plan's §0.3 quotes 2,278 (15.4%) and 76 fills / $38,473 for the same window. Those figures
-- could not be reproduced: the query above was re-run 2026-09-01 against production with the session
-- timezone confirmed as UTC, and `(fueled_at at time zone 'UTC')::date` and `fueled_at::date` return
-- an identical 1,833. Both plan figures are ~25% higher than anything measurable here. The smaller,
-- reproducible numbers are the ones this migration claims, and the deviation is recorded in the plan
-- rather than quietly adopted — the benefit is real and it is smaller than the plan advertised.
--
-- Nobody typed a bug. `fueled_at` is right, `stationDateTime` is right, and the filter is right about
-- an instant. What is missing is a stored answer to "which business day is this fill on", so that the
-- filter and the display stop deriving it separately.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY A TRIGGER, AND NOT THE TWO OBVIOUS ALTERNATIVES
--
-- NOT a generated column. `fuel_business_date` is `stable`, not `immutable`, and deliberately so —
-- 0247's own comment records the reason: `at time zone` reads the server's tz database, which a
-- server upgrade can move. Postgres will not accept a non-immutable expression in a generated column
-- or an index expression. A trigger has no such requirement, because it evaluates once at write time
-- and stores the answer.
--
-- NOT a stamp in the writers. `scripts/table-writers.json` lists ELEVEN writers of this table —
-- including `apps/web/src/features/fuel/useFuelLog.ts`, i.e. the browser inserts directly. Asking
-- eleven call sites to remember a derived column is a defect waiting on the twelfth, and letting a
-- browser assert a business date is a browser asserting a conclusion. The trigger overwrites whatever
-- a writer sends, which is the point: this column is derived, and no caller may claim it.
--
-- The trigger also keeps clear of the `set search_path` inlining penalty that took the spend page down
-- (0247's trap, ~128× per row on a scalar): it evaluates the function on ONE row at write time, never
-- across an unbounded scan at read time.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- THE BACKFILL IS ONE STATEMENT, AND ITS COST WAS MEASURED RATHER THAN ASSUMED
--
-- 14,808 rows / 39 MB. `explain (analyze)` over the full table evaluating `fuel_business_date` on
-- every row: **81 ms** (parallel seq scan, 2026-09-01, production). That is the whole cost of the
-- backfill, paid once. It is quoted here because "a set-based backfill over the whole table" is
-- exactly the shape 0247's trap warns about, and the answer is that this table is small — an answer
-- that stops being true if the table grows an order of magnitude, which is why the number is written
-- down instead of the reassurance.

-- ── the column ───────────────────────────────────────────────────────────────────────────────────
alter table fuel_transactions add column if not exists business_date date;

comment on column fuel_transactions.business_date is
  'Station-local calendar day of the fill (0287, D-FUI11). DERIVED — maintained by trg_ftxn_business_date from fueled_at + state; a writer cannot assert it. This is the day EFS prints and the day a controller means by "August".';

-- ── the trigger that owns it ─────────────────────────────────────────────────────────────────────
-- Unconditional on purpose. A `when (new.fueled_at is distinct from old.fueled_at or ...)` guard would
-- be cheaper and would also let a row whose business_date was nulled or hand-set stay wrong through
-- every subsequent update. One function call per written row is not a cost worth that.
create or replace function set_fuel_transaction_business_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.business_date := fuel_business_date(new.fueled_at, new.state);
  return new;
end;
$$;

drop trigger if exists trg_ftxn_business_date on fuel_transactions;
create trigger trg_ftxn_business_date
  before insert or update on fuel_transactions
  for each row execute function set_fuel_transaction_business_date();

-- ── the one-shot backfill ────────────────────────────────────────────────────────────────────────
-- ⚠ THE TWO OTHER TRIGGERS ON THIS TABLE ARE MUTED FOR THE STATEMENT, and that is not an optimisation.
-- A bare `update fuel_transactions set business_date = ...` touches all 14,808 rows and therefore also
-- fires:
--
--   · `trg_ftxn_updated` → `set_updated_at()`, which would stamp `updated_at = now()` on EVERY fill in
--     the carrier's history. Backfilling a derived column is not a modification of the fill, and a
--     table where every row claims it changed today is a table that can no longer answer when anything
--     actually did.
--   · `trg_fuel_txn_satellites` → `sync_fuel_txn_satellites()` (0261), which upserts into
--     `fuel_txn_recon`, `fuel_txn_scores` and `fuel_txn_dispositions` — up to three writes per row,
--     ~44k of them, each stamping its own `updated_at`. `business_date` is not mirrored into any
--     satellite, so every one of those writes would be a no-op that leaves a timestamp behind.
--
-- Both are re-enabled immediately, inside the same transaction, so a failure anywhere rolls the whole
-- thing back rather than leaving the table unguarded. `trg_fuel_transactions_org_immutable` is left
-- alone — no org changes here, and a guard against exactly that is one to leave armed.
alter table fuel_transactions disable trigger trg_ftxn_updated;
alter table fuel_transactions disable trigger trg_fuel_txn_satellites;

-- Every row, not just the null ones: the trigger is authoritative from here on, so any pre-existing
-- value is one no writer was ever allowed to set. `trg_ftxn_business_date` stays ENABLED through this
-- and computes the same answer for each row, which is what makes re-running the statement harmless.
update fuel_transactions set business_date = fuel_business_date(fueled_at, state);

alter table fuel_transactions enable trigger trg_fuel_txn_satellites;
alter table fuel_transactions enable trigger trg_ftxn_updated;

-- ── the index the next merge's filter will use ───────────────────────────────────────────────────
-- Plain b-tree on the STORED column. An index on the expression is unavailable for the same reason a
-- generated column is: `fuel_business_date` is `stable`.
create index if not exists idx_fuel_txn_org_business_date
  on fuel_transactions (org_id, business_date desc);
