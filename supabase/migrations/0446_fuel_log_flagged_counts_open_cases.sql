-- 0446 — the Fuel Log's "Flagged" tile counts fills with an OPEN case, not fills that ever had one
-- (F02-F04 PLAN.md chunk 11a, AUDIT.md N5).
--
-- ── THE GAP ─────────────────────────────────────────────────────────────────────────────────────
-- `fuel_range_totals.flagged` was `count(*) filter (where has_anomaly)`, and `has_anomaly` does not mean
-- "somebody still has to look at this". The flag reconcile (`anomalyFlagReconcile.ts`) keeps it true for
-- every fill with a NON-SUPERSEDED case — dismissed and resolved included — because the row's red marker
-- opens that truck's whole case history, closed cases too, and that is still a true pointer. Under a tile
-- that reads "anomalies need review" it is a false one.
--   · Audit 2026-10-07: 137 fills flagged, 56 of them with no open or investigating case.
--   · Re-measured 2026-10-09 (read-only, production), after the 10-08 detection reset (0441) closed every
--     open case: 138 canonical fills flagged, 0 with an open or investigating case. The tile said 138
--     fills needed review; the Alerts work queue it points at was empty.
--
-- ── WHAT CHANGES ────────────────────────────────────────────────────────────────────────────────
-- `flagged` counts the matched fills that have at least one case in queue state OPEN — the Alerts page's
-- work queue, which is what that page shows when nobody has chosen a status (`useAnomaliesPage.ts`), and
-- the set the tile's new link opens. Not `investigating`: a case somebody has taken is not waiting for
-- review, and counting it would make the tile one higher than the queue it links to.
--
-- The status list is `anomalyStatusesIn("open")` in `@silvicom/shared` (findingQueue.ts, C7a). SQL cannot
-- import it, so it is written here as the one value it is today, and `fuel-range-totals.test.mjs` DERIVES
-- its expectation from that function for every status in `ANOMALY_STATUSES`: a status mapped onto
-- `open` later fails that matrix until this function counts it. A copy with a gate on it, the way
-- `lint:section-policies` holds the role lists in policies to `rolesThatCanView`.
--
-- The start-date rule is D-CF9's (0439, `caseIsAfterReset` in detectionEpoch.ts), written whole: a case
-- before the org's detection start date is not shown, unless it is being investigated. The investigating
-- arm cannot fire while only `open` is counted; it is kept so the rule here reads as the rule everywhere
-- else, and a reader widening the status list does not have to rediscover it.
--
-- `clear` does not move: it is still the fills with no flag at all. So `flagged + clear = fills` no longer
-- holds, and that is the point — the difference is the fills whose every case is closed. A dismissed
-- false alarm is not "clear" (its row stays marked and opens its history), and it is not waiting for
-- anyone either.
--
-- ── RLS ─────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER, as before, so the browser's caller now also reads `anomalies` through their own
-- token. `anomalies_select` (0004) is `org_id = auth_org_id()` for every office role, and drivers are
-- refused by `anomalies_driver_deny` — and by 0417 on `fuel_transactions` before that. So every role
-- that reads the Fuel Log (fuel: view) reads its cases; the matrix asserts it for an accountant, who
-- holds fuel and not safety.
--
-- ── DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md §the-deploy-window) ─────────────────────────────
-- A function body: same name, same arguments, same columns. Old code against the new body gets the right
-- count under the old sub-line; new code against the old body gets the old count under the new sub-line
-- for the minutes between. No column, so no two-merge split.
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────────────────────────
-- Re-run 0315's `create or replace function fuel_range_totals` body.

create or replace function fuel_range_totals(
  p_from            date default null,
  p_to              date default null,
  p_driver          uuid default null,
  p_tank_type       text default null,
  p_search          text default null,
  p_search_vehicles uuid[] default null,
  p_search_drivers  uuid[] default null,
  p_org             uuid default null,
  p_vehicles        uuid[] default null
)
returns table (
  fills              int,
  gallons            numeric,
  spend              numeric,
  has_cost           boolean,
  flagged            int,
  clear              int,
  fills_with_vehicle int
)
language sql
stable
security invoker
set search_path = public
as $$
  with matched as (
    select t.id, t.org_id, t.gallons, t.total_cost, t.has_anomaly, t.vehicle_id
      from fuel_transactions t
     where t.org_id = coalesce(p_org, auth_org_id())
       -- The list beneath these tiles reads canonical fills only. A tile counting a different set than
       -- the rows under it is the disagreement FUEL-T3a exists to end.
       and t.is_canonical
       -- The window is the BUSINESS DATE (0287, FUEL-T1; EFS's Central day since 0444), not the instant.
       -- Comparing a date to a date makes `p_to` inclusive without the `T23:59:59` the instant needed.
       and (p_from is null or t.business_date >= p_from)
       and (p_to   is null or t.business_date <= p_to)
       -- FUEL-P1. An EMPTY array is not null and matches nothing, which is the true answer to "these
       -- trucks" when the trucks named do not exist here. The caller sends null for "the whole fleet",
       -- and `vehicleIdsForUnits` in `@silvicom/shared` is the one place that distinguishes them.
       and (p_vehicles is null or t.vehicle_id = any(p_vehicles))
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
    -- 0446 (N5): a fill with an OPEN case, after the start date — see the header. `exists`, so a fill
    -- with two open cases is one fill: the tile counts fills, as every tile above this table does.
    count(*) filter (where exists (
      select 1
        from anomalies a
        join organizations o on o.id = a.org_id
       where a.transaction_id = m.id
         and a.org_id = m.org_id
         and a.status = 'open'  -- anomalyStatusesIn("open"); held to it by fuel-range-totals.test.mjs
         and (a.status = 'investigating' or o.detection_epoch is null or a.fueled_at is null
              or a.fueled_at >= o.detection_epoch)
    ))::int,
    -- Clear is the fills with no flag at all — unchanged by 0446. A null `has_anomaly` is not flagged.
    count(*) filter (where not coalesce(m.has_anomaly, false))::int,
    -- FUEL-T5. Counted over `matched`, so it is a share of the rows on screen and not of the fleet:
    -- a window filtered to one truck reports that truck's fills, all of which name it. A count taken
    -- outside the filters would be a different question wearing this one's clothes.
    count(*) filter (where m.vehicle_id is not null)::int
  from matched m
$$;

comment on function fuel_range_totals is
  'FUEL-T3a — Fuel Log range tiles that are pure addition, summed server-side so no client page cap '
  'can make them read low. Returns `fills_with_vehicle` (FUEL-T5, migration 0297) so the page can say '
  'what its per-truck figures cover. Takes `p_vehicles` (FUEL-P1, migration 0312; the scalar it '
  'replaced was dropped by 0315) so the tiles answer for the same set of trucks the list below them '
  'shows. `flagged` counts fills with an OPEN case after the detection start date (0446, N5), not '
  'fills whose `has_anomaly` is set; `clear` is still the fills with no flag. Deliberately returns '
  'neither fleet MPG nor total miles: both are judgement (D-AG1, migration 0252) and stay in TypeScript.';
