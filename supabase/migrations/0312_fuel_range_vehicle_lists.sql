-- 0312: the Fuel Log's tiles can be scoped to a SET of trucks, not one (FUEL-P1, D-FUI15).
--
-- ── WHAT THIS UNBLOCKS ──────────────────────────────────────────────────────────────────────────
-- Every list in the fuel section takes one truck. "Show me 654 and 696 for August" — the ordinary
-- shape of a conversation with a driver group, a terminal or a customer's dedicated fleet — is not
-- answerable anywhere in the product (§0.4 of the consolidation plan measured multi-select as absent
-- from every fuel page except Fuel Spend). P1 adds it, and a filter that narrows the LIST while the
-- six tiles above it keep answering for the whole fleet would be worse than no filter at all: two
-- numbers on one screen describing two different sets, which is the disagreement the T-series spent
-- four steps removing.
--
-- So the two functions behind those tiles learn the same vocabulary the list is about to speak.
--
-- ── WHY A NEW PARAMETER RATHER THAN A WIDER `p_vehicle` ─────────────────────────────────────────
-- `p_vehicle uuid` cannot hold a list, and changing its TYPE would break the deployed reader the
-- moment this lands. The deploy window (`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window) serves a
-- merge about nine minutes before its schema arrives, so for those nine minutes the PREVIOUS build is
-- talking to THIS schema. A new parameter WITH A DEFAULT is invisible to a caller that does not pass
-- it — the input-side twin of 0297's "an extra returned column is ignored by the old reader" — so the
-- current Fuel Log keeps working unchanged against this function, and the reader that uses
-- `p_vehicles` merges next.
--
-- ⚠ `lint:migration-ordering` reads COLUMNS and cannot see a function's signature, so nothing
-- mechanical will catch a reader that jumps the gun here. The check before merging the reader is
-- `pg_proc`, by hand — the standing note in `hold-a-function-reader-behind-its-migration`.
--
-- `p_vehicle` survives this merge unused and is dropped by 0314 once no source names it: add → switch
-- → drop, which is the shape a rename has to take in this repository and the shape a parameter takes
-- for the same reason. Two ways to say one thing is a state to pass through, never one to stop in.
--
-- ── WHY THE TWO PREDICATES ARE INDEPENDENT ──────────────────────────────────────────────────────
-- `p_vehicle` and `p_vehicles` are both applied, and conjunctively. A caller that passes both gets the
-- intersection, which is the only defensible reading of two truck filters arriving together; the
-- reader passes exactly one. Making the list SUPERSEDE the scalar would have been a silent
-- reinterpretation of an argument somebody deliberately sent.
--
-- ── WHY IT IS A DROP AND RECREATE, TWICE ────────────────────────────────────────────────────────
-- `create or replace function` cannot change a signature: adding a parameter defines a SECOND
-- function beside the first, and PostgREST — which resolves an RPC on the argument names in the body
-- it is given — would then face two candidates for the same call and answer "could not choose the
-- best candidate function". So each old signature is dropped by its full argument list and recreated
-- in the same migration, which `supabase db push` runs inside one transaction: no session ever
-- observes either function missing.
--
-- Everything else in both bodies is 0289's and 0290's, reproduced unchanged so the two can be diffed.
-- The only edits are the new parameter and the one predicate that reads it.

drop function if exists fuel_range_totals(date, date, uuid, uuid, text, text, uuid[], uuid[], uuid);

create or replace function fuel_range_totals(
  p_from            date default null,
  p_to              date default null,
  p_vehicle         uuid default null,
  p_driver          uuid default null,
  p_tank_type       text default null,
  p_search          text default null,
  p_search_vehicles uuid[] default null,
  p_search_drivers  uuid[] default null,
  p_org             uuid default null,
  -- Appended LAST, like 0297's returned column and for the same reason: PostgREST calls by name and
  -- the PGlite matrices call by name, but a positional reader that ever appears gets the arguments it
  -- already knew, in the order it already knew them.
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
       and (p_vehicle   is null or t.vehicle_id = p_vehicle)
       -- FUEL-P1. An EMPTY array is not null and matches nothing, which is the true answer to "these
       -- trucks" when the trucks named do not exist here — the same argument `NO_SUCH_VEHICLE` makes
       -- in `unitFilter.ts`. The caller sends null for "the whole fleet".
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
  'what its per-truck figures cover. Takes `p_vehicles` (FUEL-P1, migration 0312) so the tiles answer '
  'for the same set of trucks the list below them shows. Deliberately returns neither fleet MPG nor '
  'total miles: both are judgement (D-AG1, migration 0252) and stay in TypeScript.';

drop function if exists fuel_range_miles_inputs(numeric, numeric, date, date, uuid, uuid, text, text, uuid[], uuid[], uuid);

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
       and (p_vehicle   is null or t.vehicle_id = p_vehicle)
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
