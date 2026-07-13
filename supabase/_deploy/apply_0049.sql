-- ────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — idle temperature backfill (CP2)
-- Copy-paste into the Supabase SQL editor and run. Idempotent.
--
-- Adds a weather cache (backfilled from Open-Meteo, free/no key) so idle events without a Samsara temperature can
-- still be judged fairly, plus a column recording where each event's temperature came from. After running, the
-- next idle sync backfills missing temperatures.
-- ────────────────────────────────────────────────────────────────────
create table if not exists weather_cache (
  lat_grid   numeric(5,1) not null,
  lng_grid   numeric(5,1) not null,
  hour_utc   timestamptz  not null,
  temp_f     numeric(6,1),
  fetched_at timestamptz  not null default now(),
  primary key (lat_grid, lng_grid, hour_utc)
);
alter table weather_cache enable row level security;
alter table idle_events add column if not exists air_temp_source text;

-- Verify:
-- select air_temp_source, count(*) from idle_events group by air_temp_source;
