-- 0258: three org-scoped functions no browser could call, because `p_org` had no DEFAULT.
--
-- ── THE DEFECT, AND IT WAS IN PRODUCTION ─────────────────────────────────────────────────────────
-- D-FC1 is stated as `security invoker` + `coalesce(p_org, auth_org_id())`, and 0254 and 0256
-- implemented the coalesce faithfully. They missed the other half: **the parameter must have a
-- default, and must therefore come last.** Without it there is no form of the function that omits
-- `p_org`, and PostgREST resolves an RPC on the exact set of NAMED arguments supplied — so a browser
-- calling `rpc("ifta_period_jurisdictions", { p_year, p_quarter })` gets:
--
--     Could not find the function public.ifta_period_jurisdictions(p_quarter, p_year)
--        in the schema cache
--
-- Two shipped surfaces were dead on arrival: `/ifta` (reported by the carrier) and Fuel Spend's "Buy
-- discipline" tab (`fuel_buy_fills`, which nobody had opened yet). Reproduced exactly as PostgREST
-- resolves it, against production:
--
--     select count(*) from ifta_period_jurisdictions(p_year => 2026, p_quarter => 2)  -- no such form
--     select count(*) from fuel_price_coverage(p_from => …, p_to => …)                -- resolves
--
-- ── WHY THE PRECEDENTS WORKED AND THESE DID NOT ─────────────────────────────────────────────────
-- `fuel_spend_lines` (0247), `fuel_price_coverage` (0251) and `fuel_spend_by_period` (0252) all put
-- `p_org` LAST with `default null`. Postgres requires defaulted parameters to follow non-defaulted
-- ones, so "last" and "defaulted" are one decision rather than two. These three put it FIRST with no
-- default — which reads identically in a diff, passes every test that calls the function with an org,
-- and is unusable from the only place that actually calls it.
--
-- `lint:rpc-org-default` now refuses the shape outright, because a contract stated only in prose is a
-- contract that gets half-implemented.
--
-- ── WHY THIS IS A DROP AND RECREATE ─────────────────────────────────────────────────────────────
-- `create or replace` cannot reorder or rename parameters, and adding one with a default creates an
-- OVERLOAD rather than replacing — leaving both forms live and making every existing three-argument
-- call ambiguous. The old signatures are dropped explicitly. Safe in one step: the ONLY callers are
-- three browser composables, all of which already fail today, so there is no window in which anything
-- works less well than it does now.
--
-- The bodies are unchanged from 0254 and 0256 — read those headers for what each function does and
-- why. This migration changes one thing: where `p_org` sits, and that it has a default.

drop function if exists fuel_buy_fills(uuid, date, date);
drop function if exists ifta_period_jurisdictions(uuid, int, int);
drop function if exists ifta_period_summary(uuid, int, int);

create or replace function fuel_buy_fills(
  p_from date,
  p_to   date,
  -- LAST, and DEFAULTED. See this migration's header: without the default there is no form of
  -- this function a browser can call, because PostgREST resolves on the named arguments given.
  p_org     uuid default null
)
returns table (
  vehicle_id          uuid,
  unit                text,
  fueled_at           timestamptz,
  tran_date           date,
  in_window           boolean,
  state               text,
  gallons             numeric,
  net_amount          numeric,
  miles_since_last    numeric,
  baseline_mpg        numeric,
  level_before_pct    numeric,
  entered_capacity_gal numeric,
  sensor_capacity_gal  numeric,
  observed_max_fill_gal numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    -- D-FC1: a browser passes nothing and is scoped by its JWT; the API passes p_org because the
    -- service role bypasses RLS; a caller that passes neither gets null, which matches no org.
    select t.vehicle_id, t.fueled_at, fuel_business_date(t.fueled_at, t.state) as bday,
           t.state, t.gallons, t.total_cost, t.miles_since_last,
           -- A level is only as good as the fill's placement in time.
           case when t.fueling_time_basis = 'tank_confirmed' then t.samsara_fuel_pct_before end as lvl
    from fuel_transactions t
    where t.org_id = coalesce(p_org, auth_org_id())
      and coalesce(t.tank_type, 'tractor') = 'tractor'
      and t.gallons > 0
      -- The instant window is widened a day each side of the LOOKBACK and the business date filtered
      -- afterwards, because a station-local date can sit either side of its UTC instant.
      and t.fueled_at >= ((p_from - 14) - 1)::timestamptz
      and t.fueled_at <  (p_to + 2)::timestamptz
  )
  select s.vehicle_id, v.unit_number, s.fueled_at, s.bday, s.bday >= p_from,
         s.state, s.gallons, s.total_cost, s.miles_since_last, v.baseline_mpg, s.lvl,
         v.tank_capacity_gal, v.sensor_capacity_gal, v.observed_max_fill_gal
  from scoped s
  join vehicles v on v.id = s.vehicle_id
  where s.bday between (p_from - 14) and p_to
  order by s.vehicle_id, s.fueled_at;
$$;

create or replace function ifta_period_jurisdictions(
  p_year    int,
  p_quarter int,
  -- LAST, and DEFAULTED. See this migration's header: without the default there is no form of
  -- this function a browser can call, because PostgREST resolves on the named arguments given.
  p_org     uuid default null
)
returns table (
  jurisdiction        text,
  -- Samsara's units, unconverted. `packages/shared/src/ifta` turns these into miles, once (D-IF1).
  taxable_meters      numeric,
  total_meters        numeric,
  tax_paid_liters     numeric,
  -- False when the code is one this product cannot price. Carried up so the surface can name the gap
  -- rather than silently dropping the miles (D-IF7).
  recognised          boolean,
  -- OUR purchases, from our own feed. Samsara sees almost none of this carrier's fuel (measured: 668
  -- gallons a quarter against 439,153), which is why the credit side is ours alone.
  purchased_gallons   numeric,
  purchased_fills     int
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (select coalesce(p_org, auth_org_id()) as org),
  months as (
    select generate_series((p_quarter - 1) * 3 + 1, (p_quarter - 1) * 3 + 3) as m
  ),
  bounds as (
    select make_date(p_year, (p_quarter - 1) * 3 + 1, 1) as from_day,
           (make_date(p_year, (p_quarter - 1) * 3 + 1, 1) + interval '3 months')::date as to_day_excl
  ),
  miles as (
    select j.jurisdiction,
           sum(j.taxable_meters)  as taxable_meters,
           sum(j.total_meters)    as total_meters,
           sum(j.tax_paid_liters) as tax_paid_liters,
           bool_and(j.recognised) as recognised
    from samsara_ifta_jurisdiction_miles j
    where j.org_id = (select org from scoped)
      and j.period_year = p_year
      and j.period_month in (select m from months)
    group by j.jurisdiction
  ),
  fuel as (
    -- Tractor diesel only, on the station-local business date — the same basis every other fuel
    -- surface uses, so a jurisdiction total here and one on the spend page cannot disagree.
    select upper(t.state) as jurisdiction,
           sum(t.gallons)::numeric as purchased_gallons,
           count(*)::int           as purchased_fills
    from fuel_transactions t
    where t.org_id = (select org from scoped)
      and coalesce(t.tank_type, 'tractor') = 'tractor'
      and t.gallons > 0
      and t.state is not null
      -- Widened a day each side on the instant, then filtered on the business date, because a
      -- station-local date can sit either side of its UTC instant (0247's rule).
      and t.fueled_at >= ((select from_day from bounds) - 1)::timestamptz
      and t.fueled_at <  ((select to_day_excl from bounds) + 1)::timestamptz
      and fuel_business_date(t.fueled_at, t.state)
            >= (select from_day from bounds)
      and fuel_business_date(t.fueled_at, t.state)
            <  (select to_day_excl from bounds)
    group by upper(t.state)
  )
  select coalesce(m.jurisdiction, f.jurisdiction),
         coalesce(m.taxable_meters, 0),
         coalesce(m.total_meters, 0),
         coalesce(m.tax_paid_liters, 0),
         -- A jurisdiction that appears only on the fuel side has no miles row to carry the flag, so
         -- it is assumed recognised and the pricing decision falls to the tax table downstream.
         coalesce(m.recognised, true),
         coalesce(f.purchased_gallons, 0),
         coalesce(f.purchased_fills, 0)
  -- FULL join on purpose: a jurisdiction with miles and no purchases owes tax, and one with purchases
  -- and no miles holds a credit. Dropping either side loses half a return.
  from miles m
  full outer join fuel f on f.jurisdiction = m.jurisdiction
  order by 1;
$$;

create or replace function ifta_period_summary(
  p_year    int,
  p_quarter int,
  -- LAST, and DEFAULTED. See this migration's header: without the default there is no form of
  -- this function a browser can call, because PostgREST resolves on the named arguments given.
  p_org     uuid default null
)
returns table (
  -- Our own odometer-derived miles for the quarter — the SECOND reading the tie-out compares against
  -- Samsara's (D-IF9). Taken from `fuel_spend_days`, which is the vetted chain: `miles_since_last` raw
  -- carries odometer resets that summed to 104 million miles for one quarter when measured directly.
  odometer_miles      numeric,
  odometer_rejected   numeric,
  purchased_gallons   numeric,
  vehicles            int,
  -- The most recent fetch per month of the quarter, folded: still provisional if ANY month is, and
  -- the worst unmapped count, because one bad month makes the quarter's total wrong.
  months_fetched      int,
  any_provisional     boolean,
  max_unmapped        int,
  last_fetched_at     timestamptz,
  troubleshooting     jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (select coalesce(p_org, auth_org_id()) as org),
  bounds as (
    select make_date(p_year, (p_quarter - 1) * 3 + 1, 1) as from_day,
           (make_date(p_year, (p_quarter - 1) * 3 + 1, 1) + interval '3 months')::date as to_day_excl
  ),
  ours as (
    select coalesce(sum(d.miles), 0)          as odometer_miles,
           coalesce(sum(d.miles_rejected), 0) as odometer_rejected,
           coalesce(sum(d.gallons_tractor), 0) as purchased_gallons,
           count(distinct d.vehicle_id)::int  as vehicles
    from fuel_spend_days d
    where d.org_id = (select org from scoped)
      and d.day >= (select from_day from bounds)
      and d.day <  (select to_day_excl from bounds)
  ),
  fetches as (
    -- One row per month: the LATEST fetch for it, since a month may have been re-fetched.
    select distinct on (f.period_month)
           f.period_month, f.provisional, f.unmapped_vehicles, f.fetched_at, f.troubleshooting
    from samsara_ifta_fetches f
    where f.org_id = (select org from scoped)
      and f.period_year = p_year
      and f.period_month between (p_quarter - 1) * 3 + 1 and (p_quarter - 1) * 3 + 3
    order by f.period_month, f.fetched_at desc
  )
  select ours.odometer_miles, ours.odometer_rejected, ours.purchased_gallons, ours.vehicles,
         (select count(*)::int from fetches),
         coalesce((select bool_or(provisional) from fetches), false),
         coalesce((select max(unmapped_vehicles) from fetches), 0),
         (select max(fetched_at) from fetches),
         -- The block from the most recent fetch in the quarter. It is per response and near-identical
         -- across months; a surface needs one, not three. `period_month desc` breaks a tie on
         -- `fetched_at`, which is not hypothetical: the scheduler fetches three months in one run and
         -- two of them can land on the same timestamp, after which "the latest" was whichever month
         -- the planner happened to return first.
         (select troubleshooting from fetches order by fetched_at desc, period_month desc limit 1)
  from ours;
$$;

-- Grants follow the new signatures; the old ones went with the dropped functions.
revoke all on function fuel_buy_fills(date, date, uuid) from public;
grant execute on function fuel_buy_fills(date, date, uuid) to authenticated, service_role;
revoke all on function ifta_period_jurisdictions(int, int, uuid) from public;
grant execute on function ifta_period_jurisdictions(int, int, uuid) to authenticated, service_role;
revoke all on function ifta_period_summary(int, int, uuid) from public;
grant execute on function ifta_period_summary(int, int, uuid) to authenticated, service_role;
