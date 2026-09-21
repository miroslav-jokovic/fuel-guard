-- 0347: one measurement of the dashboard, taken where the rows are
--
-- Queue item 5 of docs/plans/fuel/DATA-PRECISION-AUDIT-2026-09-20.md, step 1 of four (§7.2c). This
-- migration adds the function and NOTHING reads it — deliberately, and not only because
-- `lint:migration-ordering` asks for it: a function with no caller cannot be served against the
-- previous schema, so step 1 cannot break the deploy window whatever order Railway and migrate.yml
-- land in.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY THIS EXISTS
--
-- `apps/web/src/features/dashboard/useDashboard.ts` draws the fleet dashboard from TEN reads across
-- six modules, two of them paged 1,000 rows at a time, plus a chunked `N x 100` .in() loop to attach
-- a driver to each flagged fill. Every other reporting surface in this product asks the API, which
-- asks the harness. D-PREC8 names that as the architectural root of D-PREC5 and D-PREC6: a component
-- that builds its own window has no access to the org's operating timezone, the station's business
-- date, or the freshness of the tables it is dividing.
--
-- All three of those are COLUMNS. So the reduction moves to where they are. The precedent is on this
-- same page: `telematics_coverage_buckets()` (0322) replaced a browser read that made 16 sequential
-- round trips over 15,948 rows, "which is why the figure could not live on this page at all"
-- (Q-SAM8).
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHAT IT DOES NOT DO, AND THIS IS THE PART THAT WILL BITE SOMEBODY
--
-- ⚠ **The windows are NOT symmetric, and that is deliberate (D-PREC7).** Fills, idle seconds and
-- declines are scoped to the picked range. The ANOMALY figures — severity counts, top vehicles by
-- risk, top drivers by risk — are NOT, and must never become so. The "Active alerts" tile links to
-- the Alerts page, which lists open cases with no date filter; range-scoping the tile would make the
-- number disagree with the page the moment a reader clicked through, which reads as "wrong data".
-- Writing this function "cleanly" against one window would silently change what four cards show and
-- NO TEST WOULD FAIL. The asymmetry is the contract.
--
-- ⚠ **It does not count declines at all, and that is the gate's doing.** The first draft did, taking
-- the window as parameters because EFS prints reject times in a fixed zone whatever the station's own
-- zone is — a rule about a vendor, already written once in `efsRejectDayWindow`, and not one to copy
-- into SQL. `lint:boundaries` then refused the migration: `declined_transactions` is `layer = raw` and
-- sealed to its collector, and every one of the 24 existing `raw-access-waiver` lines is the OWNER
-- acting on its own table — none is a foreign reader taking a shortcut. Waiving it here would have
-- been the first of a new kind, which is the workaround shape this repo names outright.
--
-- So the count stays with `fuel`, and the dashboard endpoint asks for it through that module's index.
-- The function is better for it: the two `p_declined_*` parameters existed ONLY to carry a window
-- this function could not compute, which was a wart rationalised rather than removed. What is left is
-- coherent — measurements over one picked calendar range, in the org's own zone.
--
-- The ORG TIMEZONE goes the other way and stays here: it is a column, a fact rather than a rule.
--
-- ⚠ **It returns MEASUREMENTS, not verdicts.** No rounding, no null-for-unknown substitution, no
-- zero-filled day series. `aggregateDashboard` in packages/shared owns all of that and keeps owning
-- it: `coveragePct` is null rather than 0 when there is nothing to divide, `allTimeCoveragePct` is
-- `?? null` and never `?? 0` because "0% corroborated is an alarming claim to make on the strength
-- of a missing argument", and a no-spend day inside the window is a real $0 day rather than a gap.
-- Those are product judgements with comments defending them; re-deciding them in SQL would be a
-- second implementation of the same arithmetic. SQL measures, TypeScript concludes.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- D-FC1 (0247): `security invoker` + `coalesce(p_org, auth_org_id())`. Not a style choice — 0246
-- relied on RLS, which holds for a browser session and FAILS for apps/api, which reads with the
-- service role and bypasses RLS; a server-rendered PDF read every carrier in the database. The API
-- passes `p_org` explicitly; a browser session may omit it and be scoped by its own claim.
--
-- `set search_path = public` is safe HERE and would not be on a per-row scalar: the search_path that
-- cost 128x per row and took the spend page down was on a function Postgres then refused to inline
-- into a row loop. This one is called once per request and returns a single row.

create or replace function dashboard_summary(
  p_from          date,
  p_to            date,
  p_org           uuid default null
)
returns table (
  -- Fills, scoped to [p_from, p_to] on business_date — the station's own day (0287, FUEL-T1).
  total_spend     numeric,
  total_gallons   numeric,
  reefer_spend    numeric,
  covered_txns    int,
  total_txns      int,
  -- Spend per day, bucketed in the ORG's operating timezone. Gaps are NOT filled: the caller
  -- zero-fills, because "which days count as inside this window" is its question, not this one's.
  spend_by_day    jsonb,
  -- ⚠ The four below are ALL-TIME open cases, not range-scoped. See the header.
  severity_counts jsonb,
  top_vehicles    jsonb,
  top_drivers     jsonb,
  open_anomalies  int,
  -- Idle seconds over the same range, from the pre-aggregated rollup the Idling page reads.
  idle_sec        numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (
    select coalesce(p_org, auth_org_id()) as id
  ),
  tz as (
    select coalesce(o.operating_hours->>'tz', 'America/Chicago') as name
      from organizations o, org
     where o.id = org.id
  ),
  fills as (
    select t.total_cost, t.gallons, t.tank_type, t.samsara_recon_at, t.fueled_at
      from fuel_transactions t, org
     where t.org_id = org.id
       and t.is_canonical
       and t.business_date >= p_from
       and t.business_date <= p_to
  ),
  fill_totals as (
    select
      coalesce(sum(f.total_cost), 0)                                                   as total_spend,
      coalesce(sum(f.gallons), 0)                                                      as total_gallons,
      coalesce(sum(f.total_cost) filter (where f.tank_type = 'reefer'), 0)              as reefer_spend,
      count(*) filter (where f.samsara_recon_at is not null)::int                       as covered_txns,
      count(*)::int                                                                     as total_txns
      from fills f
  ),
  days as (
    -- `at time zone` twice is the idiom, not a typo: the first reads the timestamptz as UTC wall
    -- time, the second re-reads that wall time in the org's zone. Slicing the ISO string instead is
    -- what mis-dated evening fills before D-FUI11.
    select to_char((f.fueled_at at time zone tz.name)::date, 'YYYY-MM-DD') as day,
           sum(f.total_cost)                                               as spend
      from fills f, tz
     group by 1
  ),
  -- ⚠ NOT range-scoped, on purpose (D-PREC7). `open` here means what the Alerts page means by it.
  open_cases as (
    select a.id, a.transaction_id, a.vehicle_id, a.severity
      from anomalies a, org
     where a.org_id = org.id
       and a.status in ('open', 'investigating')
  ),
  -- The chunked `N x 100` .in() loop the browser needed to attach a driver to a flagged fill. Here it
  -- is a join, and the fill may be older than the visible range — which is exactly why the browser
  -- could not resolve it from the fills it had already fetched.
  --
  -- `left join` is defensive and, measured, currently EQUIVALENT to an inner one: `transaction_id` is
  -- NOT NULL with an FK to fuel_transactions ON DELETE CASCADE, so no open case can point at a fill
  -- that is not there. A mutation of this line to `join` survives the matrix for that reason, and
  -- that is a no-op mutant rather than a gap. It stays `left` because the day either constraint is
  -- relaxed — and D-FX2 already argues `anomalies.transaction_id is not null` is awkward for
  -- `missing_in_system`-shaped findings — an inner join would silently drop cases from the risk
  -- lists instead of showing them with no driver.
  case_drivers as (
    select c.id, c.vehicle_id, c.severity, t.driver_id
      from open_cases c
      left join fuel_transactions t on t.id = c.transaction_id
  ),
  veh_risk as (
    select d.vehicle_id as id,
           coalesce(v.unit_number, '—')                              as label,
           count(*)::int                                             as anomaly_count,
           count(*) filter (where d.severity = 'critical')::int       as critical_count
      from case_drivers d
      left join vehicles v on v.id = d.vehicle_id
     where d.vehicle_id is not null
     group by d.vehicle_id, v.unit_number
     order by critical_count desc, anomaly_count desc
     limit 5
  ),
  drv_risk as (
    select d.driver_id as id,
           coalesce(dr.full_name, '—')                               as label,
           count(*)::int                                             as anomaly_count,
           count(*) filter (where d.severity = 'critical')::int       as critical_count
      from case_drivers d
      left join drivers dr on dr.id = d.driver_id
     where d.driver_id is not null
     group by d.driver_id, dr.full_name
     order by critical_count desc, anomaly_count desc
     limit 5
  ),
  idle as (
    select coalesce(sum(r.idle_sec), 0) as idle_sec
      from idle_rollup_days r, org
     where r.org_id = org.id
       and r.day >= p_from
       and r.day <= p_to
  )
  select
    ft.total_spend,
    ft.total_gallons,
    ft.reefer_spend,
    ft.covered_txns,
    ft.total_txns,
    coalesce((select jsonb_agg(jsonb_build_object('date', d.day, 'value', d.spend) order by d.day) from days d), '[]'::jsonb),
    coalesce((select jsonb_object_agg(s.severity, s.n)
                from (select c.severity, count(*)::int as n from open_cases c group by c.severity) s), '{}'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(v) order by v.critical_count desc, v.anomaly_count desc) from veh_risk v), '[]'::jsonb),
    coalesce((select jsonb_agg(to_jsonb(r) order by r.critical_count desc, r.anomaly_count desc) from drv_risk r), '[]'::jsonb),
    (select count(*)::int from open_cases),
    i.idle_sec
    from fill_totals ft, idle i
$$;

comment on function dashboard_summary(date, date, uuid) is
  'Fleet dashboard measurements in one round trip (audit queue item 5, step 1). Fills and idle are range-scoped; anomaly figures are ALL-TIME open cases and must stay that way (D-PREC7). Declines are NOT here — declined_transactions is a sealed raw table and the count belongs to the fuel module. Returns measurements only: rounding, zero-fill and null-for-unknown belong to aggregateDashboard.';
