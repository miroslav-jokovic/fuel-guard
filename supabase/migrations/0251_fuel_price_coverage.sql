-- 0251: the page knows which days it can price, and never says so
--
-- Discount capture scores each fill against the price Pilot quoted for that station that day. Quotes
-- come from a report somebody uploads, so coverage is an operational fact — and measured on production
-- 2026-08-25 it is the single largest thing wrong with the surface:
--
--     default 90-day window, tractor diesel
--     5,552 fills · $3,066,991 paid
--     1,409 quoted (25.4% of fills) · $849,913 measurable — 27.8% OF SPEND
--     `fuel_prices` holds 20 days, 2026-08-02 → 2026-08-25, and nothing before it
--
-- So the tab's headline variance describes just over a quarter of the bill while reading as a
-- fleet-wide verdict. F1 put the share beside the figure, which stops it being misleading. This is the
-- other half: telling the reader WHICH DAYS are missing, so the number can be made bigger.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY A FUNCTION RATHER THAN A CLIENT-SIDE COUNT
--
-- The browser could group the lines it already fetches. It would be wrong twice: it only sees the days
-- that have FILLS, so a day with neither a fill nor a quote looks identical to a day fully covered;
-- and it cannot see quotes outside the window, which is exactly what "quotes start on the 2nd" needs.
-- This reads `fuel_prices` directly and reports the range as a fact about the org rather than about
-- whatever the reader happened to filter to.
--
-- D-PC1 — `security invoker`, `coalesce(p_org, auth_org_id())`
--
-- Same contract as `fuel_spend_lines` (D-FC1, 0247): a browser is scoped by RLS off its own JWT and
-- passes nothing; the API passes `p_org` explicitly because the service role bypasses RLS; a caller
-- that passes neither gets null, which equals no org, which returns no rows. Fails closed.
--
-- D-PC2 — one row per day, INCLUDING the days with nothing
--
-- `generate_series` over the window rather than a group-by over what exists. A gap is the finding
-- here, and a query that can only return days it found rows for cannot report one.

create or replace function fuel_price_coverage(
  p_from date,
  p_to   date,
  p_org  uuid default null
)
returns table (
  day          date,
  quoted_sites int,
  -- Days since the newest quote at or before this day, or null when none exists at all. 0 is a
  -- same-day quote, 1 is one carried forward — the same `quote_stale_days` the fills carry.
  stale_days   int
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select id from organizations where id = coalesce(p_org, auth_org_id())
  ),
  days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  priced as (
    select (p.observed_at at time zone 'UTC')::date as day, count(distinct p.station_id)::int as sites
    from fuel_prices p
    join scoped s on s.id = p.org_id
    where p.product = 'diesel'
      -- Widened behind the window so a day at its leading edge can still find yesterday's quote.
      and p.observed_at >= ((p_from - 7)::timestamp at time zone 'UTC')
      and p.observed_at <  ((p_to + 1)::timestamp at time zone 'UTC')
    group by 1
  )
  select
    d.day,
    coalesce(pr.sites, 0) as quoted_sites,
    (select (d.day - max(p2.day))::int from priced p2 where p2.day <= d.day) as stale_days
  from days d
  left join priced pr on pr.day = d.day
  order by d.day;
$$;

revoke all on function fuel_price_coverage(date, date, uuid) from public;
grant execute on function fuel_price_coverage(date, date, uuid) to authenticated, service_role;
