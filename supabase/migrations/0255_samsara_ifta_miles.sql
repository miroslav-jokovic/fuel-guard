-- 0255: the miles, by jurisdiction — stored exactly as Samsara reported them (S1, D-IF1).
--
-- ── WHY THIS TABLE HOLDS METRES AND NOT MILES ────────────────────────────────────────────────────
-- Every derived quantity in an IFTA calculation carries a policy inside it: which miles are taxable,
-- what the fleet's MPG was that quarter, which quarter's tax rate applies, whether a jurisdiction is
-- priceable at all. Each of those has been got wrong somewhere in this codebase already. Stored data
-- outlives the rule that produced it, so a corrected rule must be applicable to history WITHOUT a
-- re-fetch — and a re-fetch of a quarter Samsara has since restated is not the same data.
--
-- So the columns are named for what the API returns: `taxable_meters`, `total_meters`,
-- `tax_paid_liters`. A column called `miles` holding a converted metre count is a lie that survives
-- every future reader. Conversion happens once, in `packages/shared`, and is tested there.
--
-- ── THE PERIOD IS A MONTH, AND THAT IS MEASURED RATHER THAN ASSUMED (D-IF10) ─────────────────────
-- The endpoint takes a year plus either a month or a quarter. Measured 2026-08-26 on this carrier:
-- April + May + June returns 4,611,351 taxable miles and Q2 returns 4,611,351 — a difference of
-- **0.0 miles**. Monthly therefore reconstructs the quarter exactly AND gives F10 a month-level burn
-- apportionment, so the month is stored and the quarter is always derived. Storing both would create
-- two rows that can disagree about one fact.
--
-- ── OPERATIONAL, NOT EVIDENCE (§1.4) ─────────────────────────────────────────────────────────────
-- Samsara restates the most recent 72 hours, so a re-fetch of a recent period is EXPECTED to differ
-- and the row must be refreshable. That makes this operational and prunable, deliberately NOT in
-- `RETENTION_FORBIDDEN`. A quarter the carrier has FILED is a different object — a record of what they
-- asserted to a jurisdiction — and gets an append-only snapshot when the filing workflow lands (S3).
-- Freezing this table instead would make ordinary re-fetching impossible.
--
-- ── WHY THE FETCH IS ITS OWN ROW ─────────────────────────────────────────────────────────────────
-- `troubleshooting` is how Samsara says why its own numbers are incomplete, and it is per RESPONSE
-- rather than per jurisdiction. Measured on this carrier: `unassignedFuelTypeVehicles = 187`, which is
-- why `tax_paid_liters` totals about 668 gallons for a quarter against the 439,153 gallons we hold
-- ourselves. A surface that shows Samsara's fuel figure without that count beside it is showing a
-- number it cannot explain, so the block is stored rather than logged.

create table if not exists samsara_ifta_fetches (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  period_year         int  not null check (period_year between 2015 and 2100),
  period_month        int  not null check (period_month between 1 and 12),
  -- What Samsara said it answered, echoed back. Asking for April and being handed May is the kind of
  -- thing that is obvious in a response and invisible once the rows are stored.
  echoed_year         int,
  echoed_month        text,
  vehicles_reported   int  not null default 0,
  rows_written        int  not null default 0,
  -- Vehicles Samsara reported that we could not join to a `vehicles` row. Counted, never dropped
  -- silently: it means the fleet and the telematics account disagree about what exists.
  unmapped_vehicles   int  not null default 0,
  -- Samsara's own account of why its numbers are incomplete, verbatim.
  troubleshooting     jsonb not null default '{}',
  -- True while the period could still be restated — the 72-hour rule (D-IF8).
  provisional         boolean not null default false,
  fetched_at          timestamptz not null default now(),
  fetched_by          uuid references auth.users(id) on delete set null
);
create index if not exists idx_samsara_ifta_fetches_period
  on samsara_ifta_fetches (org_id, period_year, period_month, fetched_at desc);

create table if not exists samsara_ifta_jurisdiction_miles (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references organizations(id) on delete cascade,
  -- Our vehicle. NOT NULL: a row we cannot attribute to a truck cannot be apportioned to that truck's
  -- fuel, so an unmapped vehicle is counted on the fetch row above rather than stored here headless.
  vehicle_id          uuid not null references vehicles(id) on delete cascade,
  -- Samsara's own id, kept beside ours so a mapping that later changes can be audited rather than
  -- guessed at. It is text because the API sends a 15-digit number.
  samsara_vehicle_id  text not null,

  period_year         int  not null check (period_year between 2015 and 2100),
  period_month        int  not null check (period_month between 1 and 12),

  jurisdiction        text not null,
  -- False for a code this product cannot price. Stored rather than dropped: an unknown jurisdiction's
  -- miles were still driven, and dropping them shrinks the denominator of every share downstream
  -- without anything saying so (D-IF7).
  recognised          boolean not null default true,

  -- Samsara's units. Not miles. Not gallons. See the header.
  taxable_meters      numeric(14,3) not null default 0,
  total_meters        numeric(14,3) not null default 0,
  tax_paid_liters     numeric(14,3) not null default 0,

  fetch_id            uuid references samsara_ifta_fetches(id) on delete set null,
  fetched_at          timestamptz not null default now(),

  constraint samsara_ifta_miles_unique unique (org_id, vehicle_id, period_year, period_month, jurisdiction)
);
create index if not exists idx_samsara_ifta_miles_period
  on samsara_ifta_jurisdiction_miles (org_id, period_year, period_month);
create index if not exists idx_samsara_ifta_miles_vehicle
  on samsara_ifta_jurisdiction_miles (org_id, vehicle_id, period_year, period_month);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Read for org members; writes are the sync's, through the service role. No client write policy on
-- either table — a browser that can write jurisdiction miles can move a tax liability.
alter table samsara_ifta_fetches            enable row level security;
alter table samsara_ifta_jurisdiction_miles enable row level security;

drop policy if exists samsara_ifta_fetches_select on samsara_ifta_fetches;
create policy samsara_ifta_fetches_select on samsara_ifta_fetches
  for select using (org_id = auth_org_id());

drop policy if exists samsara_ifta_miles_select on samsara_ifta_jurisdiction_miles;
create policy samsara_ifta_miles_select on samsara_ifta_jurisdiction_miles
  for select using (org_id = auth_org_id());
