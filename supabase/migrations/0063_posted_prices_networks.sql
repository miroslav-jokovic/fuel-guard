-- 0063: Global posted-price layer + station registry precision + per-org network switches
-- (FUEL-PRICE-DATA-PLAN.md Phase A). Posted retail prices are GLOBAL facts (Pilot's public network-wide
-- table) shared by every org — ingested once, read by all — while the existing per-org `fuel_prices`
-- stays the tenant's negotiated NET layer. Station rows gain the exact-export fields (address, precise
-- coord provenance, amenity counts) so city-centroid geocodes can be replaced and audited.

-- Station registry precision (from the Pilot "Download All Locations" export) ----------
alter table fuel_stations add column if not exists address          text;
alter table fuel_stations add column if not exists city             text;
alter table fuel_stations add column if not exists zip              text;
alter table fuel_stations add column if not exists country          text not null default 'US';
alter table fuel_stations add column if not exists phone            text;
alter table fuel_stations add column if not exists parking_spaces   int;
alter table fuel_stations add column if not exists fuel_lane_count  int;
alter table fuel_stations add column if not exists shower_count     int;
alter table fuel_stations add column if not exists amenities        text[];
-- Coordinate provenance: 'exact_export' (chain's own lat/lng) vs 'geocoded_city' (city centroid — the
-- legacy email-ingest placement). The planner/UI can surface precision; ingest never downgrades exact.
alter table fuel_stations add column if not exists coord_source     text not null default 'geocoded_city';
alter table fuel_stations add column if not exists location_updated_at timestamptz;

-- Global posted retail prices (chain-public facts; org-agnostic) ----------
create table if not exists fuel_prices_posted (
  id            uuid primary key default gen_random_uuid(),
  station_id    uuid not null references fuel_stations(id) on delete cascade,
  product       text not null default 'diesel',             -- diesel | def
  price         numeric(7,3) not null,
  currency      text not null default 'USD',                -- USD | CAD (Canadian sites quote CAD)
  unit          text not null default 'gal',                -- gal | L   (Canadian sites quote per liter)
  bio_blend     text,                                       -- B0..B20 label of the diesel sold (metadata)
  source        text not null,                              -- 'pilot_public_page' | 'pilot_public_xlsx' | ...
  observed_at   timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_fuel_prices_posted_lookup on fuel_prices_posted (station_id, product, observed_at desc);
create index if not exists idx_fuel_prices_posted_source on fuel_prices_posted (source, observed_at desc);
alter table fuel_prices_posted enable row level security;
drop policy if exists fuel_prices_posted_select on fuel_prices_posted;
create policy fuel_prices_posted_select on fuel_prices_posted for select using (auth_org_id() is not null);
-- writes: service role only (central ingest), same posture as fuel_stations.

-- Per-org network switches: which truck-stop networks are turned ON (hard registry filter) ----------
alter table route_fuel_settings add column if not exists enabled_brands text[] not null default '{pilot,flying_j,one9}';
