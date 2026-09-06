-- 0316: the Fuel log's miles tile learns where its window ENDS (2026-09-05).
--
-- ── THE DEFECT THIS COMPLETES THE FIX FOR ───────────────────────────────────────────────────────
-- `robustWindowMiles` and its aggregate twin preferred the OBD span as soon as TWO rows carried an OBD
-- reading, whether or not those rows reached the window's ends. Where the OLDEST fill has no OBD
-- reading, everything the truck drove before the first OBD reading disappears — and nothing
-- contradicts it, because the number that comes back is a real span of real readings, just not of this
-- window. Measured on production 2026-09-05, the anomaly engine's version of that read **815 miles
-- where the window's own odometers span 1,552**, which is what the over-fuel queue was made of.
--
-- The TypeScript learned the rule in the merge before this one. It could not learn it HERE at the same
-- time, because this function had no idea which row sat at either end: `obd_min`/`obd_max` are extrema,
-- and an extremum cannot say whether it came from the first fill or the fourth. So the aggregate gains
-- the two measurements the rule needs, and — as with every other column here — decides nothing.
--
-- ── WHY THE READER COULD SHIP FIRST, WHICH IS THE OPPOSITE OF THE USUAL ORDER ───────────────────
-- `docs/MIGRATION-DISCIPLINE.md` §the-deploy-window: Railway serves a merge ~3 minutes in and this
-- applies ~12 minutes in, so every merge must work against the PREVIOUS schema for about nine minutes.
-- Here the previous schema is a function without these two columns, PostgREST omits what a function
-- does not return, and `windowMilesFromAggregate` reads an absent field as `undefined` — which it
-- documents as "the database has not been taught the ends yet" and answers exactly as it did before.
-- `false` would have been the dangerous default: it would blank the Fuel log's miles tile for the
-- whole window. Same distinction, same reason, as `fills_with_vehicle` (0297) reporting null, not 0.
--
-- ── WHAT IT CHANGES ON THE SCREEN ───────────────────────────────────────────────────────────────
-- Measured over 2026-08: the Fuel log's Total miles goes from 1,442,189 to 1,453,228 (+0.77%), from 8
-- of 165 trucks whose oldest fill in the month carries no OBD reading. Small here and enormous in the
-- anomaly engine for one reason: the defect costs a window the distance before its first OBD reading,
-- and a month has fifteen fills to dilute that while a 48-hour scoring window has two.
--
-- ⚠ A DROP IS REQUIRED, AND IT IS NOT 0315'S HAZARD. Postgres refuses `create or replace` when the
-- OUT-parameter row type changes ("cannot change return type of existing function"), so the function
-- is dropped and recreated. Its ARGUMENT list is untouched, which is what 0315's stale-tab warning was
-- actually about: no caller's call signature changes, the drop and the create are one transaction, and
-- a tab holding the previous bundle simply keeps ignoring the two new columns.
--
-- Everything below is 0315's function, unchanged except for the `readable`/`ends` CTEs and the two
-- columns they produce.

drop function if exists fuel_range_miles_inputs(numeric, numeric, date, date, uuid, text, text, uuid[], uuid[], uuid, uuid[]);

create or replace function fuel_range_miles_inputs(
  p_mpg_min         numeric,
  p_mpg_max         numeric,
  p_from            date default null,
  p_to              date default null,
  p_driver          uuid default null,
  p_tank_type       text default null,
  p_search          text default null,
  p_search_vehicles uuid[] default null,
  p_search_drivers  uuid[] default null,
  p_org             uuid default null,
  p_vehicles        uuid[] default null
)
returns table (
  vehicle_id          uuid,
  obd_count           int,
  obd_min             numeric,
  obd_max             numeric,
  entered_count       int,
  entered_min         numeric,
  entered_max         numeric,
  -- Most negative step between consecutive entered readings, clamped at 0 so "never went backwards"
  -- reads the same whatever the climb looked like; null when there are fewer than two readings to step
  -- between. NOT a verdict — see 0290's header.
  entered_worst_step  numeric,
  -- Σ(computed_mpg · gallons) and Σ(gallons) over fills inside the caller's band. TypeScript divides.
  --
  -- ⚠ DEAD SINCE M4b (2026-09-04): fleet MPG comes from GET /api/fueling/fleet-mpg, whose numerator is
  -- two odometer readings rather than a ratio taken back out of the fuel. They stay because an applied
  -- migration may never be edited and dropping them is a third signature change for no gain; nothing
  -- reads them. `scripts/check-single-mpg.mjs` carries the carve-out that says so.
  mpg_weighted        numeric,
  mpg_gallons         numeric,
  -- Whether each source has a reading at BOTH ENDS of this truck's window (0316). MEASUREMENTS, not
  -- verdicts — `windowMilesFromAggregate` decides what to do with them, exactly as it does with
  -- `entered_worst_step`. See the migration header for what they are for.
  obd_covers_ends     boolean,
  entered_covers_ends boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select t.id, t.vehicle_id, t.fueled_at, t.odometer, t.samsara_odometer,
           t.samsara_odometer_source, t.gallons, t.computed_mpg
      from fuel_transactions t
     where t.org_id = coalesce(p_org, auth_org_id())
       and t.is_canonical
       and (p_from is null or t.business_date >= p_from)
       and (p_to   is null or t.business_date <= p_to)
       and (p_vehicles  is null or t.vehicle_id = any(p_vehicles))
       and (p_driver    is null or t.driver_id  = p_driver)
       and (p_tank_type is null or t.tank_type  = p_tank_type)
       and (
         p_search is null
         or t.location_text ilike '%' || fuel_search_escape(p_search) || '%'
         or t.card_ref      ilike '%' || fuel_search_escape(p_search) || '%'
         or (p_search_vehicles is not null and t.vehicle_id = any(p_search_vehicles))
         or (p_search_drivers  is not null and t.driver_id  = any(p_search_drivers))
       )
  ),
  -- The step is computed over the non-null entered readings ONLY, because that is the sequence the
  -- TypeScript version walks: it filters nulls out before checking for a regression, so a fill with no
  -- odometer must not manufacture a step of its own or break the chain across it.
  stepped as (
    select m.vehicle_id,
           m.odometer,
           m.odometer - lag(m.odometer) over (
             partition by m.vehicle_id order by m.fueled_at, m.id
           ) as step
      from matched m
     where m.odometer is not null
  ),
  -- The window's ENDS, and what each source has there (0316). "Readable" is a row carrying EITHER
  -- odometer: a fill with neither says nothing about where the window began, so letting it define an
  -- end would suppress a window two good readings could have measured. Ordered exactly as `stepped`
  -- orders, because the TypeScript walks one sequence and this must be that same sequence.
  readable as (
    select m.vehicle_id,
           (m.samsara_odometer_source = 'obd' and m.samsara_odometer is not null) as has_obd,
           (m.odometer is not null)                                               as has_entered,
           row_number() over (partition by m.vehicle_id order by m.fueled_at,      m.id)      as rn_first,
           row_number() over (partition by m.vehicle_id order by m.fueled_at desc, m.id desc) as rn_last
      from matched m
     where m.odometer is not null
        or (m.samsara_odometer_source = 'obd' and m.samsara_odometer is not null)
  ),
  ends as (
    select r.vehicle_id,
           count(*) as readable_count,
           bool_or(r.has_obd)     filter (where r.rn_first = 1) as obd_first,
           bool_or(r.has_obd)     filter (where r.rn_last  = 1) as obd_last,
           bool_or(r.has_entered) filter (where r.rn_first = 1) as entered_first,
           bool_or(r.has_entered) filter (where r.rn_last  = 1) as entered_last
      from readable r
     group by r.vehicle_id
  )
  select
    m.vehicle_id,
    count(*) filter (where m.samsara_odometer_source = 'obd' and m.samsara_odometer is not null)::int,
    min(m.samsara_odometer) filter (where m.samsara_odometer_source = 'obd'),
    max(m.samsara_odometer) filter (where m.samsara_odometer_source = 'obd'),
    count(*) filter (where m.odometer is not null)::int,
    min(m.odometer),
    max(m.odometer),
    -- ⚠ `least(min(step), 0)` is WRONG here and the matrix caught it: Postgres `LEAST` IGNORES nulls,
    -- so a truck with a single reading — which has no step to measure — came back 0, i.e. "never went
    -- backwards", instead of null. The TypeScript spec returns null, and the difference matters the
    -- moment a caller reads the column without also checking `entered_count`.
    (select case when min(s.step) is null then null else least(min(s.step), 0) end
       from stepped s
      where s.vehicle_id is not distinct from m.vehicle_id),
    -- `filter` rather than a CASE sum: a fill outside the band contributes to NEITHER the numerator nor
    -- the denominator, which is what makes this a mean over plausible fills and not a diluted one.
    coalesce(sum(m.computed_mpg * m.gallons) filter (
      where m.computed_mpg is not null and m.gallons > 0
        and m.computed_mpg >= p_mpg_min and m.computed_mpg <= p_mpg_max), 0),
    coalesce(sum(m.gallons) filter (
      where m.computed_mpg is not null and m.gallons > 0
        and m.computed_mpg >= p_mpg_min and m.computed_mpg <= p_mpg_max), 0),
    -- Fewer than two readable rows is not a covered window: there is no span to measure between two
    -- ends that are the same row. Matches `windowEndCoverage`, which returns false for both sources
    -- before it looks at either.
    (select coalesce(e.readable_count >= 2 and e.obd_first and e.obd_last, false)
       from ends e where e.vehicle_id is not distinct from m.vehicle_id),
    (select coalesce(e.readable_count >= 2 and e.entered_first and e.entered_last, false)
       from ends e where e.vehicle_id is not distinct from m.vehicle_id)
  from matched m
  group by m.vehicle_id
$$;


comment on function fuel_range_miles_inputs is
  'FUEL-T3b — per-truck odometer MEASUREMENTS and banded MPG sums for the Fuel Log tiles. Returns no '
  'verdicts: robustWindowMiles and its aggregate twin stay in TypeScript (D-AG1, migration 0252), and '
  'the plausibility band arrives as a required parameter so there is never a second copy of it here. '
  'Takes `p_vehicles` (FUEL-P1, migration 0312) so Total miles answers for the trucks the list shows. '
  'Reports `obd_covers_ends`/`entered_covers_ends` (0316) because a source may only answer for a '
  'window whose ends it reaches — an extremum cannot say which fill it came from. `mpg_weighted` and '
  '`mpg_gallons` are dead since M4b and are kept only because an applied migration cannot be edited.';
