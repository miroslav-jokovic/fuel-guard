-- 0289: the Fuel Log's range totals are summed where the rows are (FUEL-T3a, D-AG1).
--
-- ── WHAT WAS WRONG, AND IT IS CORRECTNESS RATHER THAN SPEED ─────────────────────────────────────
-- The six tiles above the Fuel Log are computed in the BROWSER, by paging `fuel_transactions` 1,000
-- rows at a time until a short page arrives. That loop is correct only while it is allowed to finish.
-- PostgREST's `max_rows` is a server setting this code does not control, and a carrier holding 14,500
-- fills is already fifteen round trips into it; the day that ceiling moves, or a network hiccup ends
-- the loop early, **every tile silently reads low** — a smaller number with no error beside it, which
-- is the most expensive kind of wrong a finance surface can be.
--
-- Summing in SQL removes the coupling entirely for the four figures that are pure addition. There is
-- no page, so there is no page to be capped.
--
-- ── WHY ONLY FOUR OF THE SIX, AND THIS IS 0252's D-AG1 ──────────────────────────────────────────
-- **"THIS SUMS. IT DOES NOT DERIVE."** Two of the tiles are judgement, not arithmetic, and they stay
-- in TypeScript where a unit test can reach them:
--
--   * **Fleet MPG** is a gallon-weighted mean over fills whose per-fill MPG falls inside a
--     plausibility band (`MPG_PLAUSIBLE_MIN/MAX`). The band exists because one implausible
--     `computed_mpg` dragged a truck's learned MPG to 64 and produced three false over-fuel signals.
--   * **Total miles** is `robustWindowMiles` — prefer the OBD span, fall back to the entered span only
--     when it is monotonic within ±1, and return NULL rather than 0 for a non-advancing window. Its own
--     header calls that null the single most important guard it makes.
--
-- Re-expressing either here would put a second copy of a rule in a place no unit test runs, and the two
-- copies would drift. That is exactly what D-AG1 forbids, so this function deliberately returns neither.
-- FUEL-T3b is the spike that asks whether a per-vehicle odometer aggregate could feed the TypeScript
-- versions **without copying a constant into SQL**, and is allowed to conclude that it cannot.
--
-- ── WHY `has_cost` IS RETURNED AND IS NOT THE SAME QUESTION AS `spend > 0` ──────────────────────
-- A window where no fill carried a cost and a window whose costs sum to zero are different facts, and
-- the tile renders them differently — "—" against "$0". `sum()` cannot tell them apart, so the
-- presence of any cost at all is returned as its own boolean rather than inferred downstream.
--
-- ── D-FC1: CALLABLE BY A BROWSER ────────────────────────────────────────────────────────────────
-- `security invoker` so the caller's RLS applies, and `p_org` is LAST with a DEFAULT so PostgREST can
-- resolve the call the browser makes — which omits it (`lint:rpc-org-default`; three functions shipped
-- broken on exactly this in 0258 and every test passed, because only a browser omits the argument).
-- The org filter is still written out rather than left to RLS alone: this is the same belt-and-braces
-- the service-role rule demands everywhere else, and it costs nothing.

-- `%`, `_` and `\` are characters somebody typed into a search box, not pattern syntax. Escaped rather
-- than stripped, because this function is callable directly and cannot assume a caller sanitised the
-- term: a bare `%` reaching `ilike` matches the ENTIRE fleet, which is the most confidently wrong
-- answer a filter can give. `\` goes first, or it would escape the escapes added after it.
create or replace function fuel_search_escape(p_term text)
returns text
language sql
immutable
as $$
  select replace(replace(replace(p_term, '\', '\\'), '%', '\%'), '_', '\_')
$$;

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
  fills    int,
  gallons  numeric,
  spend    numeric,
  has_cost boolean,
  flagged  int,
  clear    int
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select t.gallons, t.total_cost, t.has_anomaly
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
    count(*) filter (where not coalesce(m.has_anomaly, false))::int
  from matched m
$$;

comment on function fuel_range_totals is
  'FUEL-T3a — Fuel Log range tiles that are pure addition, summed server-side so no client page cap '
  'can make them read low. Deliberately returns neither fleet MPG nor total miles: both are judgement '
  '(D-AG1, migration 0252) and stay in TypeScript.';
