-- 0188: give a park session its own location, so it can own its weather.
--
-- WHY (audit 2026-08-13). Ambient temperature is the gate on the Optimized-Idle avoidable verdict, and the
-- only per-session source of it was `idle_events.air_temp_f`, matched to the session by time overlap. That
-- coupled our own engine-state model back to Samsara's idling feed: a park session's idle seconds come from
-- engineStates, the events come from a different detector with a 2-minute floor, and the two never line up
-- exactly. Fleet-wide ambient coverage was 93.1% but only 49% of sessions were gap-free, which under the old
-- all-or-nothing envelope rule zeroed every Optimized-Idle truck.
--
-- The fix is to stop borrowing. `/fleet/vehicles/stats/history?decorations=gps` — the call the idle sync
-- ALREADY makes — returns latitude/longitude on every engineStates sample (verified against the live API:
-- 11/11 samples carried both). Storing the park's own fix lets the equipment-evidence sync read hourly
-- temperature straight from `weather_cache` (Open-Meteo, migration 0049) for the hours the park actually
-- spans, with no idle-event dependency and no coverage gaps to inherit.
--
-- A park is stationary by definition, so a single fix describes the whole of it. Nullable: sessions built
-- before this migration, and any sample that arrives without a gps decoration, simply have no location and
-- fall back to the previous behaviour rather than blocking.
alter table idle_park_sessions add column if not exists lat numeric(9,6);
alter table idle_park_sessions add column if not exists lng numeric(9,6);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'idle_park_sessions_latlng_check'
  ) then
    alter table idle_park_sessions add constraint idle_park_sessions_latlng_check
      check (
        (lat is null and lng is null)
        or (lat between -90 and 90 and lng between -180 and 180)
      );
  end if;
end $$;

-- Where the ambient reading on the session came from, so a row is never ambiguous about whether its
-- temperature is its own or inherited from an overlapping idle event.
alter table idle_park_sessions add column if not exists ambient_source text not null default 'none';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'idle_park_sessions_ambient_source_check'
  ) then
    alter table idle_park_sessions add constraint idle_park_sessions_ambient_source_check
      check (ambient_source in ('session_weather', 'idle_events', 'none'));
  end if;
end $$;
