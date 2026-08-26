-- 0252: the browser fetched thirteen thousand rows to show thirteen
--
-- The trend tab reads `fuel_spend_days` — one row per truck per day — and displays weekly aggregates.
-- Measured on production 2026-08-26, the default 90-day window:
--
--     fuel_spend_days rows in the window     13,095
--     distinct days                              88
--     weekly figures actually displayed          13
--     PostgREST pages of 1,000, fetched SERIALLY 14
--
-- Fourteen sequential round trips before the first tile can render, to compute thirteen numbers. The
-- rows are never shown individually — not one truck-day appears anywhere on the surface.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-AG1 — THIS SUMS. IT DOES NOT DERIVE.
--
-- The obvious version of this function returns finished figures: MPG, cost per mile, idle cost. It
-- would be wrong, and not by a little. `periodTotals` does not merely divide — it refuses an MPG
-- outside a plausibility band, scales implied miles so `gal = miles ÷ MPG` holds as an identity on
-- TOTAL gallons, withholds idle unless the engine feed covered enough of the period, and values an
-- idle hour at what that period actually paid rather than at a constant. Every one of those is a
-- judgement that has already been got wrong once and fixed, and re-expressing them in SQL would put a
-- second copy of each somewhere no unit test can reach.
--
-- So the split is at the seam the code already had: this returns exactly the sums the fold produced —
-- `SpendDaySums` in `@fuelguard/shared` — and `periodTotalsFromSums` derives from them, unchanged.
-- Addition is what a database does well and what a matrix can verify exactly. Judgement stays in one
-- place. `supabase/tests/fuel-spend-by-period.test.mjs` asserts the two agree row for row.
--
-- D-AG2 — `activeTrucks` IS NOT A COUNT OF ROWS
--
-- A truck is active on a day it fuelled or drove, not on a day the telematics feed merely emitted a
-- row for it. Counting rows dilutes miles-per-truck and turns the fleet-size term of the bridge into
-- coverage noise: on real 2026-08 data the naive count moved 172 → 166 while the working fleet grew.
-- The `filter (where fills > 0 or drive_sec > 0)` below is that rule, and it is a DISTINCT count over
-- the whole period rather than a per-day sum.
--
-- D-AG3 — THE EDGES ARE CLAMPED, AND SAY SO
--
-- A bucket is a calendar week; the data is whatever the window holds. Reported canonically, a report
-- covering "to 2026-08-24" printed a row labelled "2026-08-24 - 2026-08-30" — a period ending six days
-- after the report did. `period_from`/`period_to` are clamped to the requested window and `partial`
-- says the bucket was cut, which is what `comparablePeriods` uses to refuse to compare against a week
-- still filling. Same rule as `spendSeries`, and the matrix checks they agree.
--
-- D-AG4 — SAME SCOPE CONTRACT AS `fuel_spend_lines` (D-FC1, 0247)
--
-- `security invoker` with `coalesce(p_org, auth_org_id())`: a browser is scoped by RLS off its own JWT
-- and passes nothing, the API passes `p_org` because the service role bypasses RLS, and a caller that
-- passes neither gets null, which equals no org, which returns no rows. Fails closed.
--
-- ⚠ NO `set search_path` ON A PER-ROW SCALAR (D-FI1, 0248). This function has none — the only helper
-- it uses is `date_trunc`, a builtin resolved through `pg_catalog`. The entry point keeps its `SET`.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- MEASURED, because 0248 exists precisely because nobody did — and the measurement corrected the
-- claim this header first carried (production, 2026-08-26, default 90-day window):
--
--     the aggregation, as SQL:        14 rows out ·  23 ms · 396 buffers
--     one page of the browser's read: 1,000 rows  · 0.7 ms          → ~10 ms across all 14 pages
--
-- So the server does MORE work, not less: grouping 13,095 rows costs more CPU than handing them
-- over in slices. An earlier draft of this comment claimed "roughly 13x on query time alone", which
-- was an assumption and is wrong.
--
-- The win is real and it is somewhere else:
--
--     round trips   14 sequential  →  2 (the series, and the window total)
--     transferred   1,991 kB       →  14 rows
--
-- Fourteen sequential round trips is ~1s of pure network latency from a browser before the first
-- tile can render, and it is the part a reader actually waits through. Twenty-three milliseconds of
-- extra server CPU to remove it is a trade worth making; twenty-three milliseconds presented as a
-- saving would not have been.

create or replace function fuel_spend_by_period(
  p_from     date,
  p_to       date,
  p_grain    text default 'week',
  p_vehicles uuid[] default null,
  p_org      uuid default null
)
returns table (
  period_from     date,
  period_to       date,
  partial         boolean,
  -- Everything below is `SpendDaySums`, name for name.
  active_trucks   int,
  days            int,
  fills           int,
  gallons_tractor numeric,
  spend_tractor   numeric,
  gallons_reefer  numeric,
  spend_reefer    numeric,
  gallons_def     numeric,
  spend_def       numeric,
  miles           numeric,
  mpg_gallons     numeric,
  miles_rejected  numeric,
  drive_sec       numeric,
  idle_sec        numeric,
  coverage_sec    numeric,
  truck_days      int
)
language sql
stable
security invoker
set search_path = public
as $$
  with scoped as (
    select d.*,
      case p_grain
        -- The whole window as one bucket. The trend tab needs it for the totals it falls back to when
        -- there are not two complete periods to compare, and `active_trucks` over a window is NOT the
        -- sum of its weeks' — a truck working every week would be counted thirteen times.
        when 'window' then p_from
        when 'day'   then d.day
        when 'month' then date_trunc('month', d.day)::date
        -- Monday-start, matching `weekOf` and how the vendor's statements run. `date_trunc('week')`
        -- is ISO and therefore already Monday-start; it is not a coincidence worth relying on
        -- silently, so it is stated here.
        else date_trunc('week', d.day)::date
      end as bucket
    from fuel_spend_days d
    where d.org_id = coalesce(p_org, auth_org_id())
      and d.day between p_from and p_to
      and (p_vehicles is null or d.vehicle_id = any (p_vehicles))
  ),
  bucketed as (
    select
      bucket,
      case p_grain
        when 'window' then p_to
        when 'day'   then bucket
        when 'month' then (bucket + interval '1 month - 1 day')::date
        else bucket + 6
      end as bucket_end,
      -- D-AG2: distinct trucks that FUELLED OR DROVE, over the whole bucket.
      count(distinct vehicle_id) filter (where fills > 0 or drive_sec > 0)::int as active_trucks,
      count(distinct day)::int                                                  as days,
      coalesce(sum(fills), 0)::int                                              as fills,
      coalesce(sum(gallons_tractor), 0)                                         as gallons_tractor,
      coalesce(sum(spend_tractor), 0)                                           as spend_tractor,
      coalesce(sum(gallons_reefer), 0)                                          as gallons_reefer,
      coalesce(sum(spend_reefer), 0)                                            as spend_reefer,
      coalesce(sum(gallons_def), 0)                                             as gallons_def,
      coalesce(sum(spend_def), 0)                                               as spend_def,
      coalesce(sum(miles), 0)                                                   as miles,
      coalesce(sum(mpg_gallons), 0)                                             as mpg_gallons,
      coalesce(sum(miles_rejected), 0)                                          as miles_rejected,
      coalesce(sum(drive_sec), 0)                                               as drive_sec,
      coalesce(sum(idle_sec), 0)                                                as idle_sec,
      coalesce(sum(coverage_sec), 0)                                            as coverage_sec,
      -- The unattributed row is fuel with no truck behind it and no engine time, so counting it would
      -- dilute coverage with days that were never observable.
      count(*) filter (where vehicle_id is not null)::int                       as truck_days
    from scoped
    group by 1, 2
  )
  select
    greatest(bucket, p_from)      as period_from,
    least(bucket_end, p_to)       as period_to,
    (bucket < p_from or bucket_end > p_to) as partial,
    active_trucks, days, fills,
    gallons_tractor, spend_tractor, gallons_reefer, spend_reefer, gallons_def, spend_def,
    miles, mpg_gallons, miles_rejected, drive_sec, idle_sec, coverage_sec, truck_days
  from bucketed
  order by 1;
$$;

revoke all on function fuel_spend_by_period(date, date, text, uuid[], uuid) from public;
grant execute on function fuel_spend_by_period(date, date, text, uuid[], uuid) to authenticated, service_role;
