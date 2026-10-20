-- Silvicom 360 — 0507 odometer_readings_for_periods: the readings fleet MPG needs, not every reading.
-- PLATFORM-RELIABILITY-PLAN D-RLY6 (opened 2026-10-20).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- `GET /api/fueling/fleet-mpg` was the route with the longest tail in production's per-minute
-- `[metrics]` on 2026-10-20: median 2.6 s, max 31.7 s. Its distance read
-- (apps/api/src/modules/samsara/samsaraOdometerReads.ts) fetched EVERY reading in
-- `[earliest start − 30 days, latest end]`, 1,000 rows a page, one page after another: ~23 pages for a
-- thirty-day window, ~160 for the 400-day maximum — and the dashboard asks three such questions at
-- once (the range, the previous range, and its weekly series).
--
-- But the rule it feeds (packages/shared/src/tmsCost/vehicleDistance.ts, `distanceByVehicle`) reads
-- exactly TWO readings per truck per counter per period: the last one at or before the period's
-- start, and the last one at or before its end — each from inside that period's own lookback window
-- (the reader narrows to `[from − 30 d, to]` before the rule sees anything). Every other row was
-- fetched, shipped and discarded.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- For each period bound (start and end) with its period's floor, and each (vehicle, counter) that
-- has a reading anywhere in the window: the LAST reading in `[floor, bound]`. That set is a SUBSET of
-- the rows the old read returned, and it contains, for every period, the two rows the rule would
-- have picked — any other row it contains is no later than the one picked, and rows below a period's
-- floor are narrowed away by the reader exactly as before. So each period's answer is unchanged; the
-- matrix (`odometer-readings-for-periods.test.mjs`) checks every bound against a brute-force scan.
--
-- `counts` is each period's own row count over `(floor, to]` — the reader publishes it (`readings`)
-- to tell "the collector has not run" from "the fleet stood still", and it must stay the count the
-- reader reported before, not the size of the reduced set. OPEN at the floor because that is what the
-- reader's narrowing has always done: it compares PostgREST's `…+00:00` text to a `…Z` instant, and at
-- an exactly equal instant `+` sorts before `.`, so a reading ON the floor was never in a period's
-- window. (The picks need no such care: a pick on the floor is narrowed away in TypeScript exactly as
-- the same row was before.) Counted in Postgres, it costs an index range scan, not a page walk.
--
-- One call, ~ (periods × 2) × trucks × counters rows back instead of tens of thousands.
-- Served by 0428's (org_id, vehicle_id, reading_at) index: each pick is one backward index probe.
--
-- raw-access-waiver: the samsara collector's own read path over its own staging table (D-SEP1) —
-- called only from apps/api/src/modules/samsara/samsaraOdometerReads.ts, the table's one reader.

create or replace function odometer_readings_for_periods(p_org uuid, p_periods jsonb)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with p as (
    select (x.ord - 1)::int                as i,
           (x.e ->> 'floor')::timestamptz  as fl,
           (x.e ->> 'from')::timestamptz   as f,
           (x.e ->> 'to')::timestamptz     as t
      from jsonb_array_elements(coalesce(p_periods, '[]'::jsonb)) with ordinality as x(e, ord)
  ),
  bounds as (
    select fl, f as at from p
    union
    select fl, t as at from p
  ),
  win as (select min(fl) as lo, max(t) as hi from p),
  series as (
    select distinct r.vehicle_id, r.source
      from public.samsara_odometer_readings r, win
     where r.org_id = p_org and r.reading_at >= win.lo and r.reading_at <= win.hi
  ),
  picked as (
    select distinct pick.vehicle_id, pick.source, pick.reading_at, pick.meters
      from bounds
     cross join series
     cross join lateral (
       select r.vehicle_id, r.source, r.reading_at, r.meters
         from public.samsara_odometer_readings r
        where r.org_id = p_org
          and r.vehicle_id = series.vehicle_id
          and r.source = series.source
          and r.reading_at >= bounds.fl
          and r.reading_at <= bounds.at
        order by r.reading_at desc
        limit 1
     ) pick
  )
  select jsonb_build_object(
    'rows', coalesce(
      (select jsonb_agg(jsonb_build_object('vehicle_id', vehicle_id, 'reading_at', reading_at, 'meters', meters, 'source', source)
                        order by vehicle_id, reading_at, source)
         from picked),
      '[]'::jsonb),
    'counts', coalesce(
      (select jsonb_agg(
                (select count(*) from public.samsara_odometer_readings r
                  where r.org_id = p_org and r.reading_at > p.fl and r.reading_at <= p.t)
                order by p.i)
         from p),
      '[]'::jsonb)
  );
$$;

-- Service role only: the org is a parameter and the function bypasses RLS, so a client that could
-- call it could read any carrier's odometers. 0412 closes new functions by default; this states it.
revoke all on function odometer_readings_for_periods(uuid, jsonb) from public, anon, authenticated;
