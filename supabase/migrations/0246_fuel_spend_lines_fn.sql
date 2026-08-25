-- 0246: fills with the posted price that applied that day, in one read
--
-- Discount capture — "how much of the pump price does our contract actually take off" — needs both
-- halves of every fill: what we PAID (the EFS feed) and what was POSTED (the daily Pilot report kept
-- since 0245). The feed carries only the first, so the tab that answers it had no source and showed an
-- empty state on a page where every other tab worked.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY A FUNCTION AND NOT TWO CLIENT READS
--
-- The obvious alternative is to fetch the fills, fetch the prices, and join them in the browser. The
-- price side does not survive that: one report is 683 stations, so a 13-week window is ~62,000 rows to
-- ship and page through in order to enrich ~1,500 fills. The join belongs where the rows are.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY `distinct on` AND NOT `join`
--
-- A station can carry more than one price for a day — the daily email and the EFS-derived layer are
-- separate sources, and a re-issued report supersedes by observation rather than by deletion. A plain
-- join would multiply the FILL by however many prices exist and silently double-count the gallons. One
-- price per station-day, newest observation first, is the only shape that cannot corrupt the fuel total.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY THE RETAIL COLUMN MAY BE NULL, AND WHY THAT IS NOT A ZERO
--
-- 17% of fills in the first real window matched no same-day price: a station missing from that day's
-- report, or a day nobody has uploaded. `analyzeDiscountCapture` already drops lines whose retail is
-- null rather than scoring them as having captured nothing, which is the difference between "we did not
-- measure this" and "this fill got no discount". Returning null preserves that distinction; returning 0
-- would manufacture a shortfall out of a missing upload.

create or replace function fuel_spend_lines(
  p_from date,
  p_to date,
  p_vehicles uuid[] default null
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
  retail_amount numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    t.fueled_at::date                                as tran_date,
    s.brand                                          as brand,
    t.state                                          as state,
    s.store_number                                   as site,
    coalesce(s.city, t.location_text)                as city,
    v.unit_number                                    as unit,
    d.full_name                                      as driver,
    case when t.tank_type = 'reefer' then 'reefer' else 'tractor' end as tank,
    t.gallons                                        as gallons,
    t.total_cost                                     as net_amount,
    -- Posted price × gallons: the retail side of the discount, at the price that applied that day.
    (pp.posted_price * t.gallons)                    as retail_amount
  from fuel_transactions t
  left join fuel_stations s on s.id = t.station_id
  left join vehicles      v on v.id = t.vehicle_id
  left join drivers       d on d.id = t.driver_id
  left join lateral (
    select distinct on (p.station_id, p.observed_at::date) p.posted_price
    from fuel_prices p
    where p.org_id = t.org_id
      and p.station_id = t.station_id
      and p.product = 'diesel'
      and p.observed_at::date = t.fueled_at::date
      and p.posted_price is not null
    order by p.station_id, p.observed_at::date, p.observed_at desc
  ) pp on true
  where t.fueled_at >= p_from::timestamptz
    and t.fueled_at < (p_to + 1)::timestamptz
    and (p_vehicles is null or t.vehicle_id = any (p_vehicles))
  order by t.fueled_at;
$$;

-- `security invoker` + the org-scoped select policies on fuel_transactions and fuel_prices means a
-- browser session sees only its own carrier's fills and prices; the API calls it with the service role,
-- where the caller's own org filter is the boundary, as everywhere else here.
revoke all on function fuel_spend_lines(date, date, uuid[]) from public;
grant execute on function fuel_spend_lines(date, date, uuid[]) to authenticated, service_role;
