-- 0049: temperature backfill for idle events (CP2). Samsara doesn't always report ambient temperature; without
-- it, an idle in genuinely extreme weather looked "avoidable". We backfill from Open-Meteo (free, no key) keyed
-- by a coarse grid cell + UTC hour, cached here so re-syncs don't refetch. Events still missing a temperature
-- after backfill are classified 'undetermined' (tracked, never counted as waste).
create table if not exists weather_cache (
  lat_grid   numeric(5,1) not null,   -- round(lat, 1) (~11 km cell)
  lng_grid   numeric(5,1) not null,   -- round(lng, 1)
  hour_utc   timestamptz  not null,   -- top of the hour, UTC
  temp_f     numeric(6,1),            -- null = fetched but no reading (don't refetch endlessly)
  fetched_at timestamptz  not null default now(),
  primary key (lat_grid, lng_grid, hour_utc)
);
-- Server-only: the API writes/reads with the service role, which bypasses RLS. Weather is public/global data,
-- so there is no org scoping and no member-facing select policy.
alter table weather_cache enable row level security;

-- Where each idle event's temperature came from, surfaced on the Data Confidence panel: samsara | backfill | none.
alter table idle_events add column if not exists air_temp_source text;
