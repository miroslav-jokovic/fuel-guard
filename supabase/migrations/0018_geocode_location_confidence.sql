-- FuelGuard — 0018 geocoding + location confidence
-- Adds a global geocode cache (fuel stations resolve to lat/lng once, reused across all transactions)
-- and per-transaction location-confidence fields so the UI can show a trustworthy verification status.

-- Global cache: keyed by a normalized station query ("name|city|state"). resolved=false records a
-- confirmed MISS so we don't re-hit the provider for an unresolvable station.
create table if not exists geocode_cache (
  query      text primary key,
  lat        numeric(9,6),
  lng        numeric(9,6),
  resolved   boolean not null default false,
  provider   text,
  created_at timestamptz not null default now()
);
alter table geocode_cache enable row level security;
-- No SELECT policy: only the API (service role, which bypasses RLS) reads/writes this cache.

-- Per-transaction location confidence + the station coordinates we matched against.
alter table fuel_transactions add column if not exists samsara_location_confidence text; -- gps_confirmed | in_state | mismatch | unknown
alter table fuel_transactions add column if not exists station_lat numeric(9,6);
alter table fuel_transactions add column if not exists station_lng numeric(9,6);
