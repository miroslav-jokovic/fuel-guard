-- 0247: price every fill against the CONTRACTED cost, on its own business date, for ONE carrier
--
-- `fuel_spend_lines` (0246) answered "what did we pay, and what was posted" and got three things wrong.
-- Each is measured below against production on 2026-08-25; none of them is a judgement call.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FC1 — THE FUNCTION HAD NO ORG FILTER, AND THE REPORT CALLS IT WITH THE SERVICE ROLE
--
-- This is the serious one. 0246 is `security invoker` and relies on RLS to scope itself, which is true
-- for a browser session and FALSE for `apps/api`, which reads with the service role and therefore
-- BYPASSES RLS — the hard rule in CLAUDE.md that every service query must org-filter itself. The
-- function took no org to filter ON, so the server-rendered PDF read every carrier in the database.
--
-- Measured: two orgs hold fills. `Silvicom Inc` (11,022) and `FuelGuard EFS QA` (267, a TEST org). The
-- QA org's rows were being counted into Silvicom's exception and discount sections. Specifically:
--
--   · The 10 "litres recorded as gallons" rows on 2026-03-19 and 2026-08-11 — 871 phantom gallons, the
--     ones that made off-network excess read −$4,508 and understated fleet MPG — are ALL QA's. Silvicom
--     has no fill under $2.50/gal. There was never anything to correct in the derivation.
--   · 0244's D-FS2 cites "160 fills since 2026-06-01 ($25,953) carry no vehicle" as the reason
--     `vehicle_id` is nullable. Those 160 are the ENTIRE QA org. Silvicom has zero unattributed fills.
--     The nullable column is harmless and stays; the figure that justified it was cross-org noise.
--
-- The fix is `p_org`, and it FAILS CLOSED: a service-role caller that forgets it gets `auth_org_id()`,
-- which is null off a JWT, which matches no row. A leak requires a mistake; a blank page announces one.
-- `p_org` defaults to null so a browser (whose RLS already scopes it) keeps working unchanged, which
-- also means the deploy window between this migration and the API rollout is not a 404.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FC2 — THE BUSINESS DATE IS STATION-LOCAL, AND 0246 USED UTC
--
-- `SpendLine.tranDate` is documented in `packages/shared/src/fuelSpend/types.ts` as "station-local
-- business date" and `fuel_spend_days` computes exactly that, via `businessDate()` in
-- `packages/shared/src/fuelSpend/rollupDerive.ts`. 0246 returned `t.fueled_at::date` — UTC, because the
-- database session runs UTC — so the same fill sat on one day in "Spend & trend" and another in
-- "Discount capture", which is precisely the cross-tab disagreement the page's own header says it
-- exists to prevent.
--
-- Which one is right is not a matter of taste: EFS prints its own business date on every line.
-- Measured over 2,720 joinable rows since 2026-08-02, `efs_transactions.tran_date` equals the
-- station-local date on 2,720 of 2,720 and the UTC date on 2,401 — 319 rows off by a day, 12% of fills.
-- `fueled_at` is a true instant converted FROM station-local wall time on import (see the note above
-- STATE_IANA_TZ in `packages/shared/src/efsImport/dateTime.ts`), so converting back with the same
-- state zone recovers the vendor's date exactly rather than approximately.
--
-- The zone table below MIRRORS STATE_IANA_TZ and carries its documented limitation with it: states
-- spanning two zones use their dominant zone, worst case one hour, which can only matter for a fill
-- within an hour of local midnight in a split state. Unknown/unmappable state falls back to UTC, the
-- same deterministic fallback `businessDate()` uses.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FC3 — "YOUR PRICE" IS A RECONCILIATION KEY, NOT A BENCHMARK
--
-- The daily Pilot "Better Of Pricing Report" carries TWO prices per site (see
-- `packages/shared/src/smartFueling/pilotPriceReport.ts`): "Retail Price", the posted price, and
-- "Your Price" — the fleet's net per-gallon with the contract discount ALREADY APPLIED. 0246 returned
-- only the first. The second — the carrier's actual contracted cost, uploaded for all 683 sites every
-- day — was parsed, stored since 0245, and never read by anything.
--
-- So discount capture scored each fill against the MEDIAN of what the fleet happened to pay that
-- period. That measures the carrier against itself: a week where every station overcharged uniformly
-- moves the median with it and reports nothing wrong. Measured against the contract instead — this
-- function's own output, tractor diesel, business dates 2026-08-02 → 2026-08-25:
--
--     1,479 fills · 1,409 quoted (95.3%) · 1,314 match "Your Price" to $0.0005/gal (93.3% of quoted)
--     19 fills billed over contract  +$177.76      10 under  −$75.30
--     net +$96.10 on $849,912.65 of quoted fuel — 0.011%      captured vs retail: $93,281.86
--
-- The median could not have found the $177.76, because $177.76 spread over 1,409 fills does not move a
-- median. The contract can, per fill, with a station and a date attached — which is the difference
-- between a number to worry about and a line to take to the vendor.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FC4 — THE QUOTE IS RESOLVED AS-OF, BOUNDED TO ONE DAY
--
-- 0246 joined on `observed_at::date = fueled_at::date`. Reports exist for 20 of the 24 days in the
-- window and the four absentees are 2026-08-03, 08-10, 08-17 and 08-24 — every Sunday. Exact-day
-- equality therefore made Sunday structurally unmeasurable: same-day-only prices 80.7% of tractor
-- gallons, against 96.0% once yesterday's quote may be carried.
--
-- The question that decides whether carrying forward is honest is not whether a stale quote is exact —
-- it is not; the worst deviation among the 224 carried fills is $0.0700/gal. It is whether carrying
-- forward MANUFACTURES exceptions. Measured, it does not:
--
--     same-day quote   1,185 fills · 1,099 at contract (92.7%) · 19 over contract · worst $0.3235/gal
--     carried forward    224 fills ·   215 at contract (96.0%) ·  0 over contract · worst $0.0700/gal
--
-- Every one of the 19 overcharges is scored against a same-day quote, so none of them is an artefact of
-- this rule. The carried group is if anything CLEANER than the fresh one, and its single deviation past
-- a cent is on the under side — the price moved down and the fleet got the better of it. Saturday's
-- contract holds on Sunday closely enough to price it and not closely enough to accuse anyone.
--
-- The bound stays at one day because nothing in the data is ever staler than one day, and an unbounded
-- as-of join would silently price a fill against a contract that had since moved — inventing a variance
-- out of an upload that never happened. It is a parameter rather than a literal so a genuine two-day
-- gap (a holiday) can be admitted by the caller after somebody looks, not by the query on its own.
-- Beyond the bound the fill is UNMEASURABLE and both amounts come back null. Null is not zero: 0246's
-- own header makes this point and it matters more now, because a null contract amount must never be
-- read as "billed exactly at contract".

-- ── state → dominant IANA zone, mirroring STATE_IANA_TZ (D-FC2) ──────────────────────────────────
create or replace function fuel_station_tz(p_state text)
returns text
language sql
immutable
parallel safe
set search_path = public
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
-- move. That rules it out of an index expression, which nothing here needs.
create or replace function fuel_business_date(p_fueled_at timestamptz, p_state text)
returns date
language sql
stable
parallel safe
set search_path = public
as $$
  select (p_fueled_at at time zone fuel_station_tz(p_state))::date;
$$;

-- ── the fills, on their own date, against their own contract ─────────────────────────────────────
-- The 3-arg form is dropped rather than left beside this one: it is the unscoped version, and an
-- overload that still leaks every carrier is not a fallback, it is the bug with a longer name.
drop function if exists fuel_spend_lines(date, date, uuid[]);

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
    -- D-FC1. `coalesce` is the whole safety property: a browser passes nothing and gets its own org
    -- from the JWT; the API passes p_org explicitly; a service-role caller that passes neither gets
    -- null, which equals no org, which returns no rows.
    select t.*, fuel_business_date(t.fueled_at, t.state) as bday
    from fuel_transactions t
    where t.org_id = coalesce(p_org, auth_org_id())
      -- The instant window is widened a day each side and the business date is filtered afterwards,
      -- because a station-local date can sit either side of its UTC instant. Narrowing on the raw
      -- timestamp alone would clip the edge days of every window by up to one day's fills.
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
    -- Contract: "Your Price" × gallons, what the fill SHOULD have cost (D-FC3).
    (q.net_price * t.gallons)                        as contract_amount,
    (t.bday - q.obs)::int                            as quote_stale_days
  from scoped t
  left join fuel_stations s on s.id = t.station_id
  left join vehicles      v on v.id = t.vehicle_id
  left join drivers       d on d.id = t.driver_id
  -- One quote per fill, newest observation at or before the business date, bounded (D-FC4). `limit 1`
  -- inside the lateral is what makes multiplying the fill impossible — the failure 0246's `distinct on`
  -- was guarding against, stated more directly.
  left join lateral (
    -- `at time zone 'UTC'` is explicit rather than a bare `::date` cast: the bare cast resolves against
    -- the SESSION timezone, so the same fill could match a different report depending on who connected.
    -- `observed_at` is stored as the report's own printed Effective Date at noon UTC (D-FP1, 0245), and
    -- naming the zone is what makes reading it back the report's date rather than the caller's.
    select p.posted_price, p.net_price, (p.observed_at at time zone 'UTC')::date as obs
    from fuel_prices p
    where p.org_id = t.org_id
      and p.station_id = t.station_id
      and p.product = 'diesel'
      and (p.observed_at at time zone 'UTC')::date <= t.bday
      and (p.observed_at at time zone 'UTC')::date >= t.bday - p_max_stale_days
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
