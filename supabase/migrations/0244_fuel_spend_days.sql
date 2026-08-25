-- 0244: the daily fuel-spend rollup (FUEL-SPEND-RECONCILIATION-PLAN §B, decisions D-FS1…D-FS6)
--
-- The question this table exists to answer is the carrier's, and it is asked of a person, not a screen:
-- "fuel cost more this week than last — why?" Answering it needs three facts joined at the same grain:
-- what we bought (fuel_transactions), how far the truck went (odometer intervals), and how long its
-- engine ran (vehicle_engine_days). Nothing joined them, so every attempt to answer re-derived the join
-- differently and produced a different number. This is that join, computed once, nightly, and kept.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FS1 — WHY VEHICLE-DAY, AND NOT VEHICLE-DAY-STATE-BRAND
--
-- A finer grain was the obvious design and it is wrong. Miles and engine seconds are properties of a
-- truck's DAY; they cannot be split across the two states it happened to buy fuel in. A grain that
-- carries a fuel dimension would have to either duplicate the day's miles onto every dimension row
-- (double-counting) or leave them on one arbitrary row (silently wrong). So the rollup carries only
-- what is genuinely per truck per day, and the state / brand / site drill-downs read
-- `fuel_transactions` directly — 11k rows, fast enough that pre-aggregating them buys nothing.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FS2 — WHY `vehicle_id` IS NULLABLE
--
-- 160 fills since 2026-06-01 ($25,953, 0.88% of spend) carry no vehicle. Dropping them would make the
-- report's total quietly disagree with the actual fuel bill, and a spend report a boss cannot reconcile
-- to the invoice is worth less than no report. They roll up to a single unattributed row per org-day.
-- `nulls not distinct` on the unique index is what makes that row upsertable — without it Postgres
-- treats every null vehicle as a distinct key and the unattributed row multiplies on every rebuild.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FS3 — WHY MILES CARRY THEIR OWN GALLONS (`mpg_gallons`), AND MPG IS NEVER miles / gallons_tractor
--
-- This is the load-bearing column and the least obvious one.
--
-- `miles_since_last` spans the interval BETWEEN two fills, and a small number of those intervals are
-- corrupt — an odometer rollback, a unit swap, a reading keyed wrong at the pump. Measured on real
-- production data from 2026-06-22: 24 of 4,004 tractor fills report over 2,500 miles, one of them
-- 12,406. Those intervals must be excluded or they wreck the mileage sum.
--
-- But excluding a fill's MILES must never exclude its GALLONS — the fuel was still bought and still
-- cost money. Divide trustworthy miles by ALL gallons and MPG collapses; divide by only the gallons
-- whose interval survived and it is right. So the rollup keeps both: `gallons_tractor` is every gallon
-- (it ties to the bill), `mpg_gallons` is the gallons whose interval we kept, and fleet MPG is
-- Σ`miles` ÷ Σ`mpg_gallons`.
--
-- This is not hypothetical. Weekly fleet MPG computed the naive way over 2026-06 reads 85.7, then 55.4,
-- then 35.8, then 6.94 — the first three are odometer contamination and the last is the truth. A report
-- that printed that series would show a spectacular efficiency collapse that never happened.
--
-- `mpg_gallons` is NOT a subset of this row's `gallons_tractor`, and the constraint below deliberately
-- does not say it is. Miles are allocated across the days of their interval (D-FS4) and their gallons
-- travel with them, so a day the truck drove through without stopping carries miles and their gallons
-- while having bought nothing. The invariant that does hold on every row is that the two move TOGETHER:
-- miles without gallons inflate MPG, gallons without miles deflate it, and both are the failure this
-- column exists to prevent. Over a whole window Σ`mpg_gallons` ≤ Σ`gallons_tractor` by construction,
-- which the rollup asserts where it can be seen — per row it cannot.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FS4 — WHY MILES ARE ALLOCATED BY DRIVE TIME
--
-- The fuel side of this table is exact: a fill happened on a date and belongs to it entirely. The miles
-- side cannot be, because a truck fuelling every third day books three days of driving against one
-- date. Left raw, daily miles (and so daily MPG, and so any daily answer) are lumpy noise.
--
-- `vehicle_engine_days.drive_sec` is a real per-day signal and covers every truck that fuels (170 of
-- 170 since 2026-07-01), so an interval's miles are spread across its days in proportion to how much
-- the truck actually drove on each. `miles_basis` records which rule was used, because a number
-- produced by allocation must say so: 'drive_time' when engine days covered the interval, 'even' when
-- they did not and the miles were spread evenly, 'none' when there were no miles to attribute.
-- Weekly and monthly totals are unaffected by the choice — allocation only moves miles WITHIN an
-- interval — so the smoothing costs nothing at the grains most of the reporting uses.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FS5 — DERIVED, THEREFORE NOT EVIDENCE
--
-- Every row here is reproducible from `fuel_transactions` + `vehicle_engine_days` by re-running the
-- rollup. It is a cache with a schema, so it is deliberately NOT added to `RETENTION_FORBIDDEN` and
-- carries no append-only trigger: a rebuild may overwrite it freely, and a wrong row is fixed by
-- fixing the source and re-running, never by editing here. `fuel_statements` (0243) is the opposite
-- case and is pinned, because a vendor's statement cannot be re-derived from anything.
--
-- D-FS6 — SCOPE. Non-fuel spend (CAT scale, oil, washer fluid — $9,073 over five weeks) lives in
-- `efs_transactions` keyed by UNIT, not by vehicle, and joining it is a different reliability problem.
-- It is deliberately out of this table; the ancillary report reads EFS directly.

create table if not exists fuel_spend_days (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  -- null = fills we could not attribute to a truck; see D-FS2. Never dropped, never guessed.
  vehicle_id      uuid references vehicles(id) on delete cascade,
  day             date not null,

  -- ── fuel: exact. A fill has a business date and belongs to it entirely. ──────────────────────
  fills           int           not null default 0,
  gallons_tractor numeric(12,3) not null default 0,
  gallons_reefer  numeric(12,3) not null default 0,
  gallons_def     numeric(12,3) not null default 0,
  spend_tractor   numeric(12,2) not null default 0,
  spend_reefer    numeric(12,2) not null default 0,
  spend_def       numeric(12,2) not null default 0,

  -- ── miles: allocated across the interval's days, carrying the gallons they may be divided by,
  --    which is why neither is tied to the fills booked on THIS day. See D-FS3 / D-FS4. ──────────
  miles           numeric(12,2) not null default 0,
  mpg_gallons     numeric(12,3) not null default 0,
  miles_basis     text          not null default 'none',
  -- intervals whose miles failed the plausibility gate; surfaced so a bad odometer is visible as a
  -- data-quality count rather than as a mysteriously good MPG.
  miles_rejected  int           not null default 0,

  -- ── engine time: copied from vehicle_engine_days, the idle side of the fuel bill. ────────────
  drive_sec       int not null default 0,
  idle_sec        int not null default 0,
  off_sec         int not null default 0,
  coverage_sec    int not null default 0,

  updated_at      timestamptz not null default now(),

  constraint fuel_spend_days_miles_basis check (miles_basis in ('drive_time', 'even', 'none')),
  -- MPG is miles / mpg_gallons, so the two must never appear without each other: miles alone read as
  -- free distance and inflate MPG, gallons alone read as distance-free fuel and deflate it (D-FS3).
  constraint fuel_spend_days_miles_pair check ((miles = 0) = (mpg_gallons = 0)),
  constraint fuel_spend_days_nonnegative check (miles >= 0 and mpg_gallons >= 0 and gallons_tractor >= 0)
);

-- `nulls not distinct` (PG15+; production runs 17.6) is what lets the unattributed row of D-FS2 be
-- upserted instead of re-inserted on every nightly rebuild. It is also the conflict target the rollup
-- writes against, so it must stay non-partial and inferable.
create unique index if not exists uq_fuel_spend_days_key
  on fuel_spend_days (org_id, vehicle_id, day) nulls not distinct;
create index if not exists idx_fuel_spend_days_org_day on fuel_spend_days (org_id, day desc);

create trigger trg_fuel_spend_days_updated before update on fuel_spend_days
  for each row execute function set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read for org members. NO client write policy — this table is derived by a service-role scheduler,
-- and a browser that could write it could assert a fuel bill that never happened.
alter table fuel_spend_days enable row level security;

drop policy if exists fuel_spend_days_select on fuel_spend_days;
create policy fuel_spend_days_select on fuel_spend_days for select using (org_id = auth_org_id());
