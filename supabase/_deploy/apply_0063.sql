-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — 0063 posted prices + station precision + network switches (FUEL-PRICE-DATA-PLAN.md Phase A)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
-- Global posted-retail layer (all orgs read, service-role writes); exact station fields; enabled_brands.
-- ────────────────────────────────────────────────────────────────────
alter table fuel_stations add column if not exists address          text;
alter table fuel_stations add column if not exists city             text;
alter table fuel_stations add column if not exists zip              text;
alter table fuel_stations add column if not exists country          text not null default 'US';
alter table fuel_stations add column if not exists phone            text;
alter table fuel_stations add column if not exists parking_spaces   int;
alter table fuel_stations add column if not exists fuel_lane_count  int;
alter table fuel_stations add column if not exists shower_count     int;
alter table fuel_stations add column if not exists amenities        text[];
alter table fuel_stations add column if not exists coord_source     text not null default 'geocoded_city';
alter table fuel_stations add column if not exists location_updated_at timestamptz;

create table if not exists fuel_prices_posted (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid not null references fuel_stations(id) on delete cascade,
  product       text not null default 'diesel',
  price         numeric(7,3) not null,
  currency      text not null default 'USD',
  unit          text not null default 'gal',
  bio_blend     text,
  source        text not null,
  observed_at   timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_fuel_prices_posted_lookup on fuel_prices_posted (station_id, product, observed_at desc);
create index if not exists idx_fuel_prices_posted_source on fuel_prices_posted (source, observed_at desc);
alter table fuel_prices_posted enable row level security;
drop policy if exists fuel_prices_posted_select on fuel_prices_posted;
create policy fuel_prices_posted_select on fuel_prices_posted for select using (auth_org_id() is not null);

alter table route_fuel_settings add column if not exists enabled_brands text[] not null default '{pilot,flying_j,one9}';
