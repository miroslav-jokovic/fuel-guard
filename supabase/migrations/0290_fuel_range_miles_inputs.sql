-- 0290: the inputs for miles and fleet MPG, measured per truck (FUEL-T3b, D-AG1).
--
-- ── THIS FUNCTION RETURNS MEASUREMENTS. IT DOES NOT DECIDE ANYTHING ─────────────────────────────
-- 0289 moved the Fuel Log's four purely additive tiles into SQL and deliberately left two behind,
-- because 0252's D-AG1 rules that judgement stays in TypeScript where a unit test can reach it:
-- `robustWindowMiles` prefers the OBD span, falls back to the entered span only when it never steps
-- backwards by more than a tolerance, and returns **null rather than 0** for a non-advancing window —
-- a guard its own header calls the single most important one it makes. The MPG tile weights only
-- per-fill values inside a plausibility band that exists because one implausible `computed_mpg` once
-- dragged a truck's learned MPG to 64 and produced three false over-fuel signals.
--
-- FUEL-T3b asked whether SQL could feed those two without a constant crossing the boundary. It can, and
-- the shape of the answer is the reason this function exists:
--
--     **SQL returns a MEASUREMENT; TypeScript owns the VERDICT.**
--
--   `span > MIN_WINDOW_ADVANCE_MI`       → return the span, TS compares.
--   `obd.length >= 2`                    → return the count, TS compares.
--   monotonic within ±1                  → return the WORST BACKWARD STEP, TS compares.
--
-- That third one is the finding. "Is this sequence monotonic within one mile" looks like it needs the
-- tolerance here; it does not. `min(odometer - lag(odometer))` is a plain window aggregate with no
-- threshold in it, and TypeScript then asks whether that number is inside its own tolerance. Nothing
-- in this file knows what ±1 is, and nothing in it should.
--
-- `packages/shared/src/anomalyRules/windowMilesAggregate.ts` holds the TypeScript side, and
-- `aggregateWindowOdo` there is the executable specification of every column below —
-- `supabase/tests/fuel-range-miles-inputs.test.mjs` asserts this SQL against it rather than against
-- prose.
--
-- ── THE MPG BAND IS A PARAMETER, WHICH IS THE OPPOSITE OF A COPY ────────────────────────────────
-- `p_mpg_min` / `p_mpg_max` have **no DEFAULT**, on purpose. A literal in a function body is a second
-- definition that drifts silently the day someone edits the TypeScript one; a required parameter cannot
-- drift, because there is nothing here to disagree with. The single definition stays in
-- `packages/shared/src/dashboard.ts` and travels at call time.
--
-- ── WHY THE GRAIN IS THE VEHICLE, AND WHY A NULL VEHICLE IS STILL A ROW ─────────────────────────
-- Miles are a per-truck odometer span, so they can only be aggregated per truck. Fleet MPG is a
-- gallon-weighted mean over ALL fills — including fills attributed to no truck, which the browser's
-- loop also counted (its `if (!r.vehicle_id) continue` sits *after* the MPG accumulation). So the null
-- vehicle gets its own row here: TypeScript sums the MPG columns across every row and the miles columns
-- across only the rows that name a truck. Dropping the null group would silently change one of the two
-- figures while looking like a tidy-up.

create or replace function fuel_range_miles_inputs(
  p_mpg_min         numeric,
  p_mpg_max         numeric,
  p_from            date default null,
  p_to              date default null,
  p_vehicle         uuid default null,
  p_driver          uuid default null,
  p_tank_type       text default null,
  p_search          text default null,
  p_search_vehicles uuid[] default null,
  p_search_drivers  uuid[] default null,
  p_org             uuid default null
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
  -- between. NOT a verdict — see the header.
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
       and (p_vehicle   is null or t.vehicle_id = p_vehicle)
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
  'plausibility band arrives as a required parameter so there is never a second copy of it here.';
