-- 0256: the two reads the IFTA ledger needs (S3), beside the rows rather than in the browser.
--
-- ── WHY SQL AND NOT A CLIENT-SIDE FOLD ───────────────────────────────────────────────────────────
-- A quarter of jurisdiction miles for this carrier is ~2,600 rows (172 trucks × ~15 jurisdictions ×
-- 3 months) and the fuel side is another ~4,000 fills. Paging 6,600 rows into a browser to display
-- fifty is the shape F9 already removed from the spend tabs, and D-FC1 exists because of it. The
-- ARITHMETIC still lives in `packages/shared/src/ifta/` — these functions only sum, so there is no
-- second implementation of the liability to drift (F9's whole argument).
--
-- ── TWO FUNCTIONS, TWO QUESTIONS ─────────────────────────────────────────────────────────────────
-- `ifta_period_jurisdictions` answers "per jurisdiction, what did we drive and what did we buy".
-- `ifta_period_summary` answers "what does the period look like as a whole, and can it be trusted" —
-- the odometer total for the miles tie-out (D-IF9), and the fetch metadata that says whether Samsara
-- had finished processing. Merging them would return the summary repeated on every jurisdiction row.
--
-- Same contract as their neighbours (D-FC1, 0247): `security invoker` so a browser is scoped by its
-- JWT, `coalesce(p_org, auth_org_id())` so the API must pass `p_org` and a caller that passes neither
-- gets nothing. No `set search_path` on a per-row scalar (D-FI1, 0248) — these are entry points and
-- keep it.
--
-- ── THE QUARTER IS THE FILING UNIT, SO IT IS THE ARGUMENT ────────────────────────────────────────
-- Miles are stored monthly (D-IF10) because a month reconstructs a quarter exactly and additionally
-- serves F10's apportionment. A RETURN is quarterly, so the read takes a quarter and does the summing
-- here rather than making every caller repeat the three-month arithmetic — and the fuel side uses the
-- same three months' business dates, so the two halves of the return cannot describe different windows.
--
-- ── MEASURED on production, 2026 Q2 (0248's rule: numbers, not adjectives) ───────────────────────
-- The FUEL half, which is the expensive one, was measured directly: 3,668 fills scanned via
-- `idx_ftxn_org_time`, grouped to 45 jurisdictions, **~50 ms**. No sequential scan, and
-- `fuel_business_date` inlines into the filter (D-FI1 holds).
--
-- ⚠ The MILES half could not be measured yet and this comment will not pretend otherwise:
-- `samsara_ifta_jurisdiction_miles` is empty in production until S1's backfill runs. Its access path
-- is `idx_samsara_ifta_miles_period` on `(org_id, period_year, period_month)`, which is the shape of
-- the predicate, and a quarter is ~2,600 rows — but the number belongs here only once somebody has
-- run it. Re-measure and replace this paragraph after the backfill.

create or replace function ifta_period_jurisdictions(
  p_org     uuid,
  p_year    int,
  p_quarter int
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
  p_org     uuid,
  p_year    int,
  p_quarter int
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

revoke all on function ifta_period_jurisdictions(uuid, int, int) from public;
grant execute on function ifta_period_jurisdictions(uuid, int, int) to authenticated, service_role;
revoke all on function ifta_period_summary(uuid, int, int) from public;
grant execute on function ifta_period_summary(uuid, int, int) to authenticated, service_role;
