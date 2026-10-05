-- 0433 — when a truck was left out of fuel tax (IFTA), as dated periods (IFTA-PRECISION-PLAN IP4, D-IP3).
--
-- ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────────────
-- An owner-operator leased onto the carrier may report its miles and fuel under the carrier's IFTA
-- licence or under its own; which one is decided per truck, and it decides whether that truck belongs in
-- OUR return at all (D-IP2). McLeod already keeps that fact: `tractor.exclude_fueltax`, the switch its
-- own fuel-tax module honours. Measured on the live database 2026-10-05: 'N' on every tractor McLeod
-- holds, active or retired — no truck has ever been excluded — so this table starts empty and stays empty
-- until the carrier flips the switch for one. Deriving the fact from the carrier's own system beats a
-- second, hand-kept list beside it (the repo's no-workarounds rule).
--
-- ── WHY PERIODS AND NOT A COLUMN ON `vehicles` ───────────────────────────────────────────────────
-- A flag holds one instant. A return is filed per quarter, and a quarter re-filed in March must use
-- that quarter's coverage, not today's: a truck that leased on in August is ours from August only
-- (D-IP3). So the roster sweep opens a period the day it first sees the switch on and closes it the day
-- it sees it off. `excluded_to` is EXCLUSIVE and NULL while open — at most one open period per truck.
--
-- ⚠ The first period starts on the day the sweep first SAW the switch, not the day the carrier set it:
-- McLeod keeps no history of the column. With zero exclusions today that loses nothing; for a truck
-- excluded before this table existed, `source = 'manual'` periods let the office state the true start.
--
-- Nothing reads this yet. IP5 makes the IFTA period reads respect it, in a later merge.

create table if not exists vehicle_fuel_tax_exclusions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  vehicle_id      uuid not null references vehicles(id) on delete cascade,
  excluded_from   date not null,
  -- Exclusive. NULL while the truck is still excluded.
  excluded_to     date,
  -- 'mcleod' = mirrored from tractor.exclude_fueltax by the roster sweep; 'manual' = stated by the office.
  source          text not null default 'mcleod' check (source in ('mcleod', 'manual')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  constraint vehicle_fuel_tax_exclusions_order check (excluded_to is null or excluded_to > excluded_from)
);

-- One open period per truck: a second "it is excluded" observation must find the first, not stack.
create unique index if not exists uq_vehicle_fuel_tax_exclusions_open
  on vehicle_fuel_tax_exclusions (org_id, vehicle_id) where excluded_to is null;
create index if not exists idx_vehicle_fuel_tax_exclusions_period
  on vehicle_fuel_tax_exclusions (org_id, excluded_from, excluded_to);

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
-- Read for org members, like the IFTA tables it qualifies. Writes are the roster sweep's, through the
-- service role: a browser that can exclude a truck can move a tax liability.
alter table vehicle_fuel_tax_exclusions enable row level security;
drop policy if exists vehicle_fuel_tax_exclusions_select on vehicle_fuel_tax_exclusions;
create policy vehicle_fuel_tax_exclusions_select on vehicle_fuel_tax_exclusions
  for select using (org_id = auth_org_id());
