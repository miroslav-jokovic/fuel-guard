-- 0248: the spend report stopped generating, because two helper functions could not be inlined
--
-- `GET /api/fueling/spend-report.pdf` began failing on the DEFAULT 90-day window with
-- `canceling statement due to statement timeout`. Shorter windows worked, which is why it read as
-- intermittent rather than broken. Measured on production, 2026-08-25:
--
--     fuel_spend_lines(2026-05-28 → 2026-08-25)   30,468 ms   5,744 rows   167,238 buffers
--     the SAME SQL with the helpers written out      665 ms   5,744 rows    12,458 buffers
--
-- Identical query, 46× apart. The difference is entirely the two scalar helpers 0247 introduced.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FI1 — `SET search_path` ON A SQL FUNCTION BLOCKS INLINING
--
-- PostgreSQL will not inline a SQL function that carries a `SET` clause: the setting has to be
-- established around the call, so the call cannot be dissolved into the surrounding query. 0247 put
-- `set search_path = public` on `fuel_station_tz` and `fuel_business_date` because every other function
-- in this schema has one, without noticing that those two are scalars evaluated PER ROW rather than
-- entry points called once.
--
-- The cost is not subtle. 5,744 evaluations:
--
--     select count(fuel_business_date(now(), 'TX')) from generate_series(1, 5744)   1,580 ms
--     the same CASE and `at time zone` written inline                                   12 ms
--
-- 128×, and `fuel_business_date` is referenced more than once per row — in the projection, twice in
-- the lateral's bounds, and again in the window filter — so the row count multiplies it.
--
-- WHY DROPPING THE `SET` IS SAFE HERE, AND ONLY HERE. `search_path` on a function that touches TABLES
-- is a real defence: a caller can otherwise shadow a table name from a schema they control. These two
-- touch no tables. `fuel_station_tz` is a CASE over a text argument and nothing else. `fuel_business_date`
-- applies `at time zone`, a built-in operator resolved through `pg_catalog`, which is searched ahead of
-- `search_path` and cannot be shadowed. Its one non-builtin reference — the call to `fuel_station_tz` —
-- is now SCHEMA-QUALIFIED, which is the property the `SET` was standing in for. `fuel_spend_lines`
-- itself KEEPS its `SET`: it reads four tables, it is the entry point, and it is called once per query
-- rather than once per row, so it is both the case that needs the defence and the case that can afford it.
--
-- D-FI2 — THE QUOTE LOOKUP IS MADE SARGABLE
--
-- Secondary, and worth doing while the function is being replaced. 0247 filtered the quote on
-- `(p.observed_at at time zone 'UTC')::date`, which wraps the indexed column in an expression and so
-- cannot use `idx_fuel_prices_lookup (org_id, station_id, product, observed_at desc)`. Comparing the
-- raw column against timestamp bounds is EXACTLY equivalent — `observed_at::date` falls in
-- `[bday - n, bday]` precisely when `observed_at` falls in `[bday - n 00:00Z, (bday + 1) 00:00Z)` —
-- and lets the index do the work:
--
--     expression-wrapped   186 ms      raw-column bounds   30 ms
--
-- The bounds are built with `::timestamp at time zone 'UTC'` rather than `::timestamptz` so they mean
-- the same instant regardless of the session's TimeZone, which a bare cast would not.
--
-- D-FI3 — WHAT THIS DOES NOT CHANGE
--
-- Nothing about the ANSWER. Same org scoping, same station-local business date, same one-day as-of
-- bound, same null-means-unmeasured contract. `supabase/tests/fuel-spend-lines.test.mjs` is unchanged
-- by this migration and still passes, which is the point: this is a rewrite of how the rows are found,
-- not of which rows they are.

-- ── the two scalars, now inlinable (D-FI1) ──────────────────────────────────────────────────────
-- ⚠ Do NOT add `set search_path` to either of these. It is not a hardening no-op here; it is a 128×
-- per-row regression, and the report times out rather than getting slower. The safety it would provide
-- is provided instead by touching no tables and schema-qualifying the one call that is not a builtin.
create or replace function fuel_station_tz(p_state text)
returns text
language sql
immutable
parallel safe
as $$
  select case upper(coalesce(p_state, ''))
    when 'CT' then 'America/New_York'    when 'DE' then 'America/New_York'
    when 'FL' then 'America/New_York'    when 'GA' then 'America/New_York'
    when 'IN' then 'America/New_York'    when 'KY' then 'America/New_York'
    when 'MA' then 'America/New_York'    when 'MD' then 'America/New_York'
    when 'ME' then 'America/New_York'    when 'MI' then 'America/New_York'
    when 'NC' then 'America/New_York'    when 'NH' then 'America/New_York'
    when 'NJ' then 'America/New_York'    when 'NY' then 'America/New_York'
    when 'OH' then 'America/New_York'    when 'PA' then 'America/New_York'
    when 'RI' then 'America/New_York'    when 'SC' then 'America/New_York'
    when 'VA' then 'America/New_York'    when 'VT' then 'America/New_York'
    when 'WV' then 'America/New_York'    when 'DC' then 'America/New_York'
    when 'ON' then 'America/Toronto'     when 'QC' then 'America/Toronto'
    when 'NB' then 'America/Halifax'     when 'NS' then 'America/Halifax'
    when 'PE' then 'America/Halifax'     when 'NL' then 'America/St_Johns'
    when 'AL' then 'America/Chicago'     when 'AR' then 'America/Chicago'
    when 'IA' then 'America/Chicago'     when 'IL' then 'America/Chicago'
    when 'KS' then 'America/Chicago'     when 'LA' then 'America/Chicago'
    when 'MN' then 'America/Chicago'     when 'MO' then 'America/Chicago'
    when 'MS' then 'America/Chicago'     when 'ND' then 'America/Chicago'
    when 'NE' then 'America/Chicago'     when 'OK' then 'America/Chicago'
    when 'SD' then 'America/Chicago'     when 'TN' then 'America/Chicago'
    when 'TX' then 'America/Chicago'     when 'WI' then 'America/Chicago'
    when 'MB' then 'America/Winnipeg'    when 'SK' then 'America/Regina'
    when 'AZ' then 'America/Phoenix'     when 'CO' then 'America/Denver'
    when 'ID' then 'America/Denver'      when 'MT' then 'America/Denver'
    when 'NM' then 'America/Denver'      when 'UT' then 'America/Denver'
    when 'WY' then 'America/Denver'      when 'AB' then 'America/Edmonton'
    when 'CA' then 'America/Los_Angeles' when 'NV' then 'America/Los_Angeles'
    when 'OR' then 'America/Los_Angeles' when 'WA' then 'America/Los_Angeles'
    when 'BC' then 'America/Vancouver'   when 'AK' then 'America/Anchorage'
    when 'HI' then 'Pacific/Honolulu'    when 'NT' then 'America/Yellowknife'
    when 'NU' then 'America/Iqaluit'     when 'YT' then 'America/Whitehorse'
    else 'UTC'
  end;
$$;

-- Stable rather than immutable: `at time zone` reads the server's tz database, which an upgrade can
-- move. `public.` on the inner call is load-bearing — it is what makes dropping the `SET` safe.
create or replace function fuel_business_date(p_fueled_at timestamptz, p_state text)
returns date
language sql
stable
parallel safe
as $$
  select (p_fueled_at at time zone public.fuel_station_tz(p_state))::date;
$$;

-- ── the same rows, found through the index (D-FI2) ──────────────────────────────────────────────
create or replace function fuel_spend_lines(
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
  quote_stale_days int
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
    (t.bday - q.obs)::int                            as quote_stale_days
  from scoped t
  left join fuel_stations s on s.id = t.station_id
  left join vehicles      v on v.id = t.vehicle_id
  left join drivers       d on d.id = t.driver_id
  -- One quote per fill, newest observation at or before the business date, bounded (D-FC4, 0247).
  -- The bounds are on the RAW column so `idx_fuel_prices_lookup` can be used (D-FI2); they select
  -- exactly the same observations the date cast did.
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

revoke all on function fuel_station_tz(text) from public;
revoke all on function fuel_business_date(timestamptz, text) from public;
revoke all on function fuel_spend_lines(date, date, uuid[], uuid, int) from public;
grant execute on function fuel_station_tz(text) to authenticated, service_role;
grant execute on function fuel_business_date(timestamptz, text) to authenticated, service_role;
grant execute on function fuel_spend_lines(date, date, uuid[], uuid, int) to authenticated, service_role;
