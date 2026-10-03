-- 0419 — idle_engine_burn_hours: what an idling engine burns, measured on INTERIOR idle hours
-- (FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md §4 Q-IE14, research pass 2026-10-03).
--
-- WHY 0409's MEASUREMENT IS REPLACED
-- 0409 sums each park's running seconds and the fuel counter's rise over the park. The counter reads
-- every 6–12 minutes while the engine runs and is spread over RUNNING time between readings
-- (`counterAt`), so the reading pair that straddles an arrival books part of the last minutes of
-- driving — at ten times idle's burn — into the park, and the pair at the departure does the same.
-- Measured on production over 1,603 parks: fuel = 0.666 gal/h × running hours + ~350 mL per park
-- (R² 0.93), so the per-park sum overstates the idle rate by the edge fuel divided by the park's
-- length — 1.39 gal/h on parks under ten minutes, 0.68 on parks over four hours, 0.749 pooled on
-- battery-APU trucks whose engine runs are short against 0.546 from the slope.
--
-- WHAT THIS MEASURES INSTEAD
-- Whole hours of `idle_engine_hours` (0404) that were idle from end to end — stopped running plus
-- brief stops = 3600 s, a fuel delta present — whose neighbouring hours both exist and hold no
-- driving, so neither the arrival's nor the departure's reading pair can reach into them. Measured
-- the same day: interior hours 0.658 gal/h (no APU, 941 h, 67 trucks), idle hours next to a drive
-- 0.700, and the regression slope above 0.666 — two independent methods within 1.2%.
--
-- A MEASUREMENT, NOT A VERDICT
-- Per truck and ambient band: interior hours and their fuel. The bands, the cohorts, the precision bar
-- and the fall-backs live in packages/shared (`learnIdleBurnRates`), as with 0409. The band of an hour
-- is the hour's own mean ambient reading (`idle_engine_hours.ambient_milli_c`); an hour without one is
-- band NULL. Neighbours are read one hour past each end of [p_from, p_to), so the first and last hours
-- of the window are judged by the same rule as every other.
--
-- 0409 stays until its reader moves (lint:migration-ordering: a function and its first reader ship
-- in separate merges); a later migration drops it.

create function public.idle_engine_burn_hours(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_band_edges_milli_c integer[]
)
returns table (vehicle_id uuid, band integer, hours integer, fuel_ml bigint)
language sql
stable
set search_path = ''
as $$
  with h as (
    select x.vehicle_id, x.hour_start, x.driving_sec, x.stopped_running_sec, x.brief_stop_sec,
           x.fuel_ml, x.ambient_milli_c,
           lag(x.hour_start)  over w as prev_hour,
           lag(x.driving_sec) over w as prev_driving,
           lead(x.hour_start)  over w as next_hour,
           lead(x.driving_sec) over w as next_driving
      from public.idle_engine_hours x
     where x.org_id = p_org
       and x.hour_start >= p_from - interval '1 hour'
       and x.hour_start <  p_to + interval '1 hour'
    window w as (partition by x.vehicle_id order by x.hour_start)
  )
  select h.vehicle_id,
         case when h.ambient_milli_c is null then null
              else width_bucket(h.ambient_milli_c, p_band_edges_milli_c) end,
         count(*)::int,
         sum(h.fuel_ml)::bigint
    from h
   where h.hour_start >= p_from
     and h.hour_start <  p_to
     and h.fuel_ml is not null
     and h.stopped_running_sec + h.brief_stop_sec = 3600
     and h.prev_hour = h.hour_start - interval '1 hour' and h.prev_driving = 0
     and h.next_hour = h.hour_start + interval '1 hour' and h.next_driving = 0
   group by 1, 2
   order by 1, 2 nulls last
$$;

comment on function public.idle_engine_burn_hours(uuid, timestamptz, timestamptz, integer[]) is
  'Q-IE14 (2026-10-03): per truck and ambient band, whole idle hours whose neighbours hold no driving,
   and their engine-counter millilitres — the idle burn without the drive''s edge fuel 0409 carries.
   A measurement; the bands, cohorts and precision bar live in packages/shared.';

revoke all on function public.idle_engine_burn_hours(uuid, timestamptz, timestamptz, integer[])
  from public, anon, authenticated;
grant execute on function public.idle_engine_burn_hours(uuid, timestamptz, timestamptz, integer[])
  to service_role;
