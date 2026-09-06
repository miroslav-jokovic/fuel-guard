-- 0315: the scalar truck parameter leaves, now that nothing calls it (FUEL-P1, merge 3 of 3).
--
-- ── THE THIRD STEP OF ADD → SWITCH → DROP ──────────────────────────────────────────────────────
-- 0312 gave `fuel_range_totals` and `fuel_range_miles_inputs` a `p_vehicles uuid[]` beside the
-- existing `p_vehicle uuid`, because a signature change cannot be deployed in one merge: the previous
-- build talks to this schema for about nine minutes (`docs/MIGRATION-DISCIPLINE.md`
-- §the-deploy-window), and it was still passing the scalar. The reader switched to the list in the
-- merge after that, and has been live since.
--
-- So the scalar is now a parameter nobody passes, and this drops it. Two ways to say one thing is a
-- state to pass THROUGH, never one to stop in: a defaulted argument that no caller uses is read by the
-- next person as a supported way to ask the question, and the two would drift the first time one of
-- them gained a clause.
--
-- **The check before merging this was `pg_proc`, by hand**, plus a grep across `apps/` and
-- `supabase/tests/` for the argument name. `lint:migration-ordering` reads COLUMNS and cannot see a
-- function's signature, so nothing mechanical guards this direction either.
--
-- ⚠ THE ONE HAZARD THIS DOES CARRY, NAMED RATHER THAN LEFT TO BE FOUND. A browser tab opened before
-- the reader deployed still holds the OLD bundle, and that bundle calls `p_vehicle`. From the moment
-- this applies, such a tab gets "could not find the function" on the Fuel Log's tiles until it is
-- reloaded. That is why this is a separate merge a day behind rather than riding with the reader: the
-- window is a stale tab's, not a deploy's, and it closes on the next page load.
--
-- Everything below is 0312's, unchanged except for the two dropped parameters and their predicates.

drop function if exists fuel_range_totals(date, date, uuid, uuid, text, text, uuid[], uuid[], uuid, uuid[]);

create or replace function fuel_range_totals(
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
  fills              int,
  gallons            numeric,
  spend              numeric,
  has_cost           boolean,
  flagged            int,
  clear              int,
  fills_with_vehicle int
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select t.gallons, t.total_cost, t.has_anomaly, t.vehicle_id
      from fuel_transactions t
     where t.org_id = coalesce(p_org, auth_org_id())
       -- The list beneath these tiles reads canonical fills only. A tile counting a different set than
       -- the rows under it is the disagreement FUEL-T3a exists to end.
       and t.is_canonical
       -- The window is the station-local BUSINESS DATE (0287, FUEL-T1), not the instant. Comparing a
       -- date to a date makes `p_to` inclusive without the `T23:59:59` the instant version needed.
       and (p_from is null or t.business_date >= p_from)
       and (p_to   is null or t.business_date <= p_to)
       -- FUEL-P1. An EMPTY array is not null and matches nothing, which is the true answer to "these
       -- trucks" when the trucks named do not exist here. The caller sends null for "the whole fleet",
       -- and `vehicleIdsForUnits` in `@silvicom/shared` is the one place that distinguishes them.
       and (p_vehicles is null or t.vehicle_id = any(p_vehicles))
       and (p_driver    is null or t.driver_id  = p_driver)
       and (p_tank_type is null or t.tank_type  = p_tank_type)
       and (
         p_search is null
         -- `%` and `_` are escaped rather than stripped: this function is callable directly, so it
         -- cannot rely on a caller having sanitised the term. A literal underscore in a card ref is a
         -- character, not a wildcard.
         or t.location_text ilike '%' || fuel_search_escape(p_search) || '%'
         or t.card_ref      ilike '%' || fuel_search_escape(p_search) || '%'
         or (p_search_vehicles is not null and t.vehicle_id = any(p_search_vehicles))
         or (p_search_drivers  is not null and t.driver_id  = any(p_search_drivers))
       )
  )
  select
    count(*)::int,
    coalesce(sum(m.gallons), 0)::numeric,
    coalesce(sum(m.total_cost), 0)::numeric,
    -- bool_or over no rows is NULL, and "no fills" must read as "no cost seen", not "unknown".
    coalesce(bool_or(m.total_cost is not null), false),
    count(*) filter (where m.has_anomaly)::int,
    -- Clear is the complement, so `flagged + clear = fills` holds by construction. A null
    -- `has_anomaly` is not flagged — the browser's `fillUps - flagged` said the same thing.
    count(*) filter (where not coalesce(m.has_anomaly, false))::int,
    -- FUEL-T5. Counted over `matched`, so it is a share of the rows on screen and not of the fleet:
    -- a window filtered to one truck reports that truck's fills, all of which name it. A count taken
    -- outside the filters would be a different question wearing this one's clothes.
    count(*) filter (where m.vehicle_id is not null)::int
  from matched m
$$;

comment on function fuel_range_totals is
  'FUEL-T3a — Fuel Log range tiles that are pure addition, summed server-side so no client page cap '
  'can make them read low. Returns `fills_with_vehicle` (FUEL-T5, migration 0297) so the page can say '
  'what its per-truck figures cover. Takes `p_vehicles` (FUEL-P1, migration 0312; the scalar it '
  'replaced was dropped by 0315) so the tiles answer for the same set of trucks the list below them '
  'shows. Deliberately returns neither fleet MPG nor total miles: both are judgement (D-AG1, '
  'migration 0252) and stay in TypeScript.';

drop function if exists fuel_range_miles_inputs(numeric, numeric, date, date, uuid, uuid, text, text, uuid[], uuid[], uuid, uuid[]);

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
  mpg_weighted        numeric,
  mpg_gallons         numeric
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
        and m.computed_mpg >= p_mpg_min and m.computed_mpg <= p_mpg_max), 0)
  from matched m
  group by m.vehicle_id
$$;

comment on function fuel_range_miles_inputs is
  'FUEL-T3b — per-truck odometer MEASUREMENTS and banded MPG sums for the Fuel Log tiles. Returns no '
  'verdicts: robustWindowMiles and the MPG mean stay in TypeScript (D-AG1, migration 0252), and the '
  'plausibility band arrives as a required parameter so there is never a second copy of it here. '
  'Takes `p_vehicles` (FUEL-P1, migration 0312) so Total miles and Avg MPG answer for the same trucks '
  'the list shows.';
