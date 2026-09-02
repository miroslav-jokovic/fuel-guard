-- 0297: the Fuel Log's tiles can say how many of the fills they count name a truck (FUEL-T5).
--
-- ── WHAT THE PAGE CANNOT SAY TODAY, AND WHY IT MATTERS MORE THAN IT SOUNDS ──────────────────────
-- Six tiles sit above the Fuel Log, and they do not all cover the same fills. **Gallons, Spend and
-- Total fill-ups count every matching row. Total miles counts only the rows attributed to a truck** —
-- `useFuelRangeTotals` skips a null `vehicle_id` outright ("a fill with no truck has no odometer span
-- to contribute"), because `windowMilesFromAggregate` measures a per-vehicle odometer span and there
-- is no span without a vehicle. Fleet MPG, deliberately, counts them all.
--
-- So two tiles standing side by side already describe different sets, and nothing on the page says so.
-- Measured in production 2026-09-02: **300 of 14,868 canonical fills — 2.0% — carry no `vehicle_id`.**
-- That is 300 fills' worth of gallons and dollars inside the totals and outside the mileage, which is
-- also 300 fills of fuel divided by miles that were never driven by anything the page can name.
--
-- T5's answer is not to change any tile. It is to make the page STATE what it covers, and a sentence
-- like that needs a denominator and a numerator over the whole filtered set — not over one page of it.
-- This returns the numerator. The wording is `describeRowCoverage` in `@silvicom/shared`, already in
-- use on Transactions and Rejections.
--
-- ── WHY THIS IS A DROP AND RECREATE ─────────────────────────────────────────────────────────────
-- `create or replace function` **cannot change a `returns table` shape** — Postgres answers "cannot
-- change return type of existing function". The old signature is dropped and the new one created in
-- the same migration, which `supabase db push` runs inside one transaction, so no session ever
-- observes the function missing. It is dropped by its full argument list rather than by name: nine
-- defaulted parameters make an unqualified drop ambiguous the moment anybody adds an overload.
--
-- ── AND WHY IT IS SAFE TO LAND AHEAD OF ITS READER, WHICH IT MUST ───────────────────────────────
-- The deploy window (`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window) serves a merge about nine
-- minutes before its schema arrives, so a column and its first reader ship separately. Note that
-- `lint:migration-ordering` **does not see functions** — it reads columns — so nothing mechanical will
-- catch a reader that jumps the gun here. The check before merging the reader is `pg_proc`, by hand.
--
-- Landing this first costs nothing: the only caller is `useFuelRangeTotals`, and it destructures the
-- fields it wants by NAME off a PostgREST JSON object. An extra key is ignored, so the current build
-- behaves identically against the new function. The reverse order would not be true — a reader
-- deployed first would read `undefined` and report that no fill in the fleet names a truck.
--
-- ── D-AG1: THIS SUMS. IT DOES NOT DERIVE. ───────────────────────────────────────────────────────
-- Counting rows whose `vehicle_id` is not null is pure addition over the same `matched` set, with no
-- threshold, band or fallback in it — the same class of figure as `flagged`, `clear` and `has_cost`,
-- and emphatically not the same class as Fleet MPG or `robustWindowMiles`, which stay in TypeScript
-- (0289's header, migration 0252). Nothing else about this function changes: the `matched` CTE gains
-- one column in its select list and the outer select gains one count. Everything else below, including
-- every comment, is 0289's and is reproduced unchanged so the two can be diffed.
--
-- `vehicle_id is not null` IS the attribution fact and needs no join: the column is a foreign key to
-- `vehicles` with `on delete restrict`, so a non-null value cannot name a truck that is not there.

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
  p_org             uuid default null
)
returns table (
  fills              int,
  gallons            numeric,
  spend              numeric,
  has_cost           boolean,
  flagged            int,
  clear              int,
  -- Appended LAST on purpose. PostgREST hands the browser named keys so position is nothing to it,
  -- but the PGlite matrix and any future positional reader get the columns they already knew, in the
  -- order they already knew them.
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
       -- the rows under it is the disagreement this whole step exists to end.
       and t.is_canonical
       -- The window is the station-local BUSINESS DATE (0287, FUEL-T1), not the instant. Comparing a
       -- date to a date makes `p_to` inclusive without the `T23:59:59` the instant version needed.
       and (p_from is null or t.business_date >= p_from)
       and (p_to   is null or t.business_date <= p_to)
       and (p_vehicle   is null or t.vehicle_id = p_vehicle)
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
  'what its per-truck figures cover: Total miles counts only attributed fills while Gallons and Spend '
  'count them all, and nothing said so. Deliberately returns neither fleet MPG nor total miles: both '
  'are judgement (D-AG1, migration 0252) and stay in TypeScript.';
