-- 0405: the Fuel Costs report's daily measurements, by network — FS1 of
-- docs/plans/fuel/FUEL-SAVINGS-AND-IDLE-ENGINE-PLAN.md (D-FSV2, D-FSV6).
--
-- The owner's review of 2026-10-01 asked the Fuel Spend page one question — where can we save money
-- on fuel — and the page could not answer it filtered by state, station or network, because nothing
-- below it could. `fuel_spend_days` is one row per truck-day with no station in it; `fuel_spend_lines`
-- has the station but is one row per fill, which is 1,955 rows for September alone and past PostgREST's
-- 1,000-row cap. The report needs the fills SUMMED per day with the filters applied where the rows are.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FSV6 — THIS SUMS. THE VERDICTS ARE TYPESCRIPT'S.
--
-- Same seam as D-AG1 (0252): every column is a count or a sum. Average price, discount, paid-vs-quote
-- and the trend against the previous range are ratios of these, made in `@silvicom/shared`. The
-- discount and contract sums come with their OWN gallons and spend, restricted to the fills that had
-- a quote — dividing a quoted-only retail sum by every gallon is how the off-network tab once printed
-- −$4.779/gal of "discount" (see `SpendTotals.retailGallons`).
--
-- `packages/shared/src/fuelSpend/reportDays.ts` (`filterFuelReportLines`, `foldFuelReportDays`) is the
-- executable spec of this function; `supabase/tests/fuel-report-days.test.mjs` asserts the two agree
-- row for row over `fuel_spend_lines`' own output.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- COMPOSED ON `fuel_spend_lines`, NOT A COPY OF IT
--
-- A fill's business date (D-FC2, station-local), its one quote (D-FC4, as-of, bounded to one day) and
-- its org scope (D-FC1) are each a rule that was got wrong once and fixed. Restating them here would be
-- a second copy that drifts the first time one is fixed again. So this function reads
-- `fuel_spend_lines` and adds only what it lacks — the station's id, appended as its LAST column so
-- every existing reader (the spend PDF, the policy scan, the reconcile tabs) sees exactly the columns
-- it saw before. A set-returning function cannot change its result type in place, so it is dropped and
-- recreated in this one transaction: there is no instant at which it is missing.
--
-- Measured on production 2026-10-02 (read-only): `fuel_spend_lines` over 07/04–10/01 grouped per
-- day × brand × tank — 5,816 fills in, 409 rows out, 838 ms. One call per report, inside the 8 s
-- `authenticated` statement timeout with room for a year's window.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FSV2 — NETWORK IS DERIVED, AND THE BRAND LIST IS AN ARGUMENT WITH NO DEFAULT
--
-- `in` = the station's brand is in `p_in_network_brands`; `out` = a known station that isn't;
-- `unknown` = no station resolved. `fuel_stations.brand` is NOT NULL (0058), so a null brand on a line
-- means exactly "no station", which is its own bucket and never folded into either side.
--
-- The list itself is the carrier's `route_fuel_settings.preferred_brands` (`{pilot, flying_j}`,
-- production 2026-10-02) — the same list the planner routes to — read by the API and passed IN. It has
-- no default on purpose: a constant here would be a second copy of R11 that could drift, and a
-- parameter with no default cannot (sql-returns-measurement: passing a constant in is the opposite of
-- copying it). PostgREST cannot resolve a call that omits it, which is the right failure.
--
-- Measured September 2026 (production, tractor): in 1,853 fills $1,285,793.43 · out 29 fills
-- $12,675.92 · unknown 20 fills $13,737.52 — summing to the $1,312,206.87 `fuel_spend_days` holds.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- SCOPE: same contract as every fuel read (D-FC1/D-AG4, and 0258's lint:rpc-org-default) —
-- `security invoker`, `p_org` LAST and defaulted, `coalesce(p_org, auth_org_id())` inside
-- `fuel_spend_lines`. A browser passes nothing and RLS scopes it; the API passes `p_org` because the
-- service role bypasses RLS; a caller passing neither gets no rows.
--
-- `set search_path` stays on both new functions: they read tables and run once per query. The
-- per-row scalars they reach (`fuel_business_date`, `fuel_station_tz`) keep NOT having one (0248).
--
-- raw-access-waiver: `fuel_spend_lines` is recreated with 0248's `fuel_prices` quote join byte for byte;
-- the only change is the appended `station_id`. No new read of the posted-prices collector's table.

drop function if exists fuel_spend_lines(date, date, uuid[], uuid, int);

create function fuel_spend_lines(
  p_from date,
  p_to date,
  p_vehicles uuid[] default null,
  p_org uuid default null,
  p_max_stale_days int default 1
)
returns table (
  tran_date date,
  brand text,
  state text,
  site text,
  city text,
  unit text,
  driver text,
  tank text,
  gallons numeric,
  net_amount numeric,
  retail_amount numeric,
  contract_amount numeric,
  quote_stale_days int,
  -- 0405: appended, so the Fuel Costs report can filter by station. Last, so no reader's columns move.
  station_id uuid
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    -- D-FC1 (0247). `coalesce` is the safety property: a browser passes nothing and gets its own org
    -- from the JWT; the API passes p_org explicitly; a service-role caller that passes neither gets
    -- null, which equals no org, which returns no rows.
    select t.*, fuel_business_date(t.fueled_at, t.state) as bday
    from fuel_transactions t
    where t.org_id = coalesce(p_org, auth_org_id())
      -- The instant window is widened a day each side and the business date filtered afterwards,
      -- because a station-local date can sit either side of its UTC instant.
      and t.fueled_at >= (p_from - 1)::timestamptz
      and t.fueled_at < (p_to + 2)::timestamptz
      and (p_vehicles is null or t.vehicle_id = any (p_vehicles))
  )
  select
    t.bday                                           as tran_date,
    s.brand                                          as brand,
    t.state                                          as state,
    s.store_number                                   as site,
    coalesce(s.city, t.location_text)                as city,
    v.unit_number                                    as unit,
    d.full_name                                      as driver,
    case when t.tank_type = 'reefer' then 'reefer' else 'tractor' end as tank,
    t.gallons                                        as gallons,
    t.total_cost                                     as net_amount,
    -- Retail: the posted price, what the discount is measured FROM.
    (q.posted_price * t.gallons)                     as retail_amount,
    -- Contract: "Your Price" × gallons, what the fill SHOULD have cost (D-FC3, 0247).
    (q.net_price * t.gallons)                        as contract_amount,
    (t.bday - q.obs)::int                            as quote_stale_days,
    s.id                                             as station_id
  from scoped t
  left join fuel_stations s on s.id = t.station_id
  left join vehicles      v on v.id = t.vehicle_id
  left join drivers       d on d.id = t.driver_id
  -- One quote per fill, newest observation at or before the business date, bounded (D-FC4, 0247).
  -- The bounds are on the RAW column so `idx_fuel_prices_lookup` can be used (D-FI2, 0248).
  left join lateral (
    select p.posted_price, p.net_price, (p.observed_at at time zone 'UTC')::date as obs
    from fuel_prices p
    where p.org_id = t.org_id
      and p.station_id = t.station_id
      and p.product = 'diesel'
      and p.observed_at >= ((t.bday - p_max_stale_days)::timestamp at time zone 'UTC')
      and p.observed_at < ((t.bday + 1)::timestamp at time zone 'UTC')
    order by p.observed_at desc
    limit 1
  ) q on true
  where t.bday >= p_from and t.bday <= p_to
  order by t.bday, t.fueled_at;
$$;

revoke all on function fuel_spend_lines(date, date, uuid[], uuid, int) from public;
grant execute on function fuel_spend_lines(date, date, uuid[], uuid, int) to authenticated, service_role;

-- ── the report's days ───────────────────────────────────────────────────────────────────────────
create or replace function fuel_report_days(
  p_from date,
  p_to date,
  -- D-FSV2: the carrier's network brands, passed in. NO DEFAULT — see the header.
  p_in_network_brands text[],
  p_vehicles uuid[] default null,
  p_states text[] default null,
  p_sites uuid[] default null,
  -- Any of 'in', 'out', 'unknown'; null = all three.
  p_network text[] default null,
  -- LAST, DEFAULTED (0258).
  p_org uuid default null
)
returns table (
  day date,
  network text,
  tank text,
  fills int,
  gallons numeric,
  spend numeric,
  retail_fills int,
  retail_gallons numeric,
  retail_spend numeric,
  retail numeric,
  contract_fills int,
  contract_gallons numeric,
  contract_spend numeric,
  contract numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with lines as (
    select l.*,
      case
        when l.brand is null then 'unknown'
        when l.brand = any (p_in_network_brands) then 'in'
        else 'out'
      end as network
    from fuel_spend_lines(p_from, p_to, p_vehicles, p_org) l
  )
  select
    l.tran_date                                                              as day,
    l.network,
    l.tank,
    count(*)::int                                                            as fills,
    coalesce(sum(l.gallons), 0)                                              as gallons,
    coalesce(sum(l.net_amount), 0)                                           as spend,
    (count(*) filter (where l.retail_amount is not null))::int               as retail_fills,
    coalesce(sum(l.gallons)    filter (where l.retail_amount is not null), 0) as retail_gallons,
    coalesce(sum(l.net_amount) filter (where l.retail_amount is not null), 0) as retail_spend,
    coalesce(sum(l.retail_amount), 0)                                        as retail,
    (count(*) filter (where l.contract_amount is not null))::int             as contract_fills,
    coalesce(sum(l.gallons)    filter (where l.contract_amount is not null), 0) as contract_gallons,
    coalesce(sum(l.net_amount) filter (where l.contract_amount is not null), 0) as contract_spend,
    coalesce(sum(l.contract_amount), 0)                                      as contract
  from lines l
  -- The fill's own state, which an unknown-station fill carries too. A site filter can never match an
  -- unknown-station fill: it has no station to name.
  where (p_states  is null or l.state = any (p_states))
    and (p_sites   is null or l.station_id = any (p_sites))
    and (p_network is null or l.network = any (p_network))
  group by l.tran_date, l.network, l.tank
  order by l.tran_date, array_position(array['in', 'out', 'unknown'], l.network), l.tank;
$$;

revoke all on function fuel_report_days(date, date, text[], uuid[], text[], uuid[], text[], uuid) from public;
grant execute on function fuel_report_days(date, date, text[], uuid[], text[], uuid[], text[], uuid) to authenticated, service_role;

-- ── the places the fleet fuelled, for the state and location filters ───────────────────────────
-- D-FSV1's location filter is "station, multi, searchable". Listing `fuel_stations` would offer every
-- one of ~880 Pilot-family sites and every station any carrier ever used; the reader wants the places
-- THEIR trucks fuelled in the window. A browser deduplicating fills would stop at 1,000 rows
-- (postgrest-caps-every-response-at-1000 — it cost the Fuel Log nine menus), so DISTINCT is here.
-- Unknown-station fills come back as one row per state with a null station, so the state menu holds
-- every state fuel was bought in, resolved or not.
create or replace function fuel_report_sites(
  p_from date,
  p_to date,
  p_org uuid default null
)
returns table (
  station_id uuid,
  brand text,
  site text,
  city text,
  state text,
  fills int,
  gallons numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.station_id,
    l.brand,
    l.site,
    -- A resolved station's city comes from `fuel_stations` and is one value; an unresolved fill's is
    -- the vendor's free text, so it is not offered as a name for a row that groups many of them.
    case when l.station_id is null then null else max(l.city) end as city,
    l.state,
    count(*)::int                  as fills,
    coalesce(sum(l.gallons), 0)    as gallons
  from fuel_spend_lines(p_from, p_to, null, p_org) l
  group by l.station_id, l.brand, l.site, l.state
  order by count(*) desc, l.state, l.station_id;
$$;

revoke all on function fuel_report_sites(date, date, uuid) from public;
grant execute on function fuel_report_sites(date, date, uuid) to authenticated, service_role;
