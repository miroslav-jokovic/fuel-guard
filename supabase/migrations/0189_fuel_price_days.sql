-- 0189: one authoritative diesel price per (org, day) — the price history the cost model reads.
--
-- WHY (audit 2026-08-13). Avoidable-idle cost was computed at ONE price for a whole range: the median of
-- the last 14 days of `fuel_prices`. Three things were wrong with that.
--
--   1. `fuel_prices` keeps no history. It is a live snapshot of posted truck-stop prices — 683 diesel rows
--      over the last 30 days, every one of them observed on a single day — so it cannot answer "what did
--      fuel cost on July 22nd" at all.
--   2. It is POSTED price, not what this fleet paid. Measured over 31 days the fleet's gallon-weighted
--      actual price averaged $4.811 while the page charged $5.109 for every day — a 6.2% over-statement,
--      and the wrong question besides: the gallon burned at idle was bought at the fleet's own price.
--   3. It was flat. Actual daily prices over that window ranged $4.223–$5.123, a 90c (21%) spread, so a
--      single number mis-prices nearly every day in the range even if its average were right.
--
-- `fuel_transactions` already records `price_per_gal` against `fueled_at`, so this history is not being
-- invented — it is being MATERIALIZED from purchases we already hold, and can be backfilled as far back as
-- the transactions go. Days with no purchase fall back explicitly (posted median, then the last known
-- price carried forward, then org settings, then a default) and every row records which, so a price is
-- never silently guessed.
--
-- Days are cut on the ORG'S OPERATING TIMEZONE, the same clock `vehicle_engine_days` and `idle_rollup_days`
-- use. A price day that did not line up with an idle day would reintroduce the mismatch 0188 removed.
create table if not exists fuel_price_days (
  org_id        uuid not null references organizations(id) on delete cascade,
  day           date not null,

  -- What the fleet actually paid: gallon-weighted mean over the day's fuel_transactions.
  actual_price_per_gal numeric(8,4),
  actual_gallons       numeric(14,3) not null default 0,
  actual_fill_count    int           not null default 0,

  -- Market reference captured for the day from the posted/net truck-stop snapshot, when one existed.
  posted_price_per_gal numeric(8,4),
  posted_sample_count  int not null default 0,

  -- The price the cost model must use for this day, and where it came from. Never null: resolution always
  -- terminates at the configured or default rate.
  effective_price_per_gal numeric(8,4) not null,
  price_source            text        not null,
  -- Set only when price_source = 'carried_forward': the day the price was carried from, so a stale price
  -- is auditable rather than indistinguishable from a fresh one.
  carried_from_day        date,

  price_version text        not null default 'fuel-price-day-v1',
  synced_at     timestamptz not null default now(),
  primary key (org_id, day)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fuel_price_days_source_check') then
    alter table fuel_price_days add constraint fuel_price_days_source_check
      check (price_source in ('actual', 'posted', 'carried_forward', 'settings', 'default'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fuel_price_days_positive_check') then
    alter table fuel_price_days add constraint fuel_price_days_positive_check
      check (
        effective_price_per_gal > 0
        and actual_gallons >= 0
        and actual_fill_count >= 0
        and posted_sample_count >= 0
        and (actual_price_per_gal is null or actual_price_per_gal > 0)
        and (posted_price_per_gal is null or posted_price_per_gal > 0)
      );
  end if;
  -- A carried price must name its origin, and a non-carried one must not pretend to have one.
  if not exists (select 1 from pg_constraint where conname = 'fuel_price_days_carry_check') then
    alter table fuel_price_days add constraint fuel_price_days_carry_check
      check (
        (price_source = 'carried_forward' and carried_from_day is not null)
        or (price_source <> 'carried_forward' and carried_from_day is null)
      );
  end if;
end $$;

create index if not exists idx_fuel_price_days_org_day on fuel_price_days (org_id, day desc);

alter table fuel_price_days enable row level security;
drop policy if exists fuel_price_days_select on fuel_price_days;
create policy fuel_price_days_select on fuel_price_days for select using (org_id = auth_org_id());
-- writes: service role only (the sync owns this table).
