-- 0254: the fill sequence the buy-quantity question needs, which `fuel_spend_lines` cannot serve.
--
-- ── WHY A SECOND READER OVER THE SAME TABLE ──────────────────────────────────────────────────────
-- F13 asks what happened BETWEEN two fills: fuel bought in a dearer state and still in the tank on
-- arrival in a cheaper one. That is a question about consecutive pairs per truck, and `fuel_spend_lines`
-- (0247) cannot answer it for three separate reasons, none of which is worth bending that function to:
--
--   1. It returns `tran_date`, a DAY. Two fills on one business date sort arbitrarily — and a fill on
--      each side of a state line on the same day is precisely the pair this feature exists to find.
--      Ordering needs the instant.
--   2. It returns `unit` (a display string) and no `vehicle_id`, so the chain cannot be keyed on the
--      truck. Two trucks sharing a unit number, or a unit renumbered mid-window, silently interleave.
--   3. It carries nothing about the tank: no level, no capacity, no odometer miles. Those are the
--      whole input to "how much of that purchase was still on board".
--
-- Same contract as its neighbour (D-FC1, 0247): `security invoker` so a browser is scoped by its JWT,
-- `coalesce(p_org, auth_org_id())` so the API must pass `p_org` explicitly and a caller that passes
-- neither gets nothing. Same no-`set search_path`-on-a-per-row-scalar rule (D-FI1, 0248) — the
-- entry point keeps it, `fuel_business_date` stays inlinable, and `explain` below confirms it inlined.
--
-- ── THE LOOKBACK, WHICH IS NOT OPTIONAL ──────────────────────────────────────────────────────────
-- A pair needs a fill on BOTH sides. Return only the window and every truck's first fill in it loses
-- its predecessor, so the leg that crossed into the window is silently unscored — about one pair per
-- truck per window, roughly 3% of the answer, and invisible. So the function returns 14 days of
-- context before `p_from` and marks it: `in_window` is false on a context row, and the caller scores a
-- pair only when its ARRIVING fill is in the window. Fourteen days is generous against a fleet that
-- fuels every 57.8 hours (Q-FX4).
--
-- ── THE TANK LEVEL IS NULLED UNLESS THE FILL'S TIMING IS CONFIRMED ───────────────────────────────
-- `samsara_fuel_pct_before` is only as good as the fill's placement in time, and `fueling_time_basis`
-- is what says whether that placement is confirmed — the same gate `consumptionContext.ts` applies
-- before it will run a tank balance. Applying it here rather than downstream means no caller can use
-- an unconfirmed level by forgetting to check. Pinned by the `fuel-buy-fills` matrix
-- ("an unconfirmed tank level comes back null, because a level is only as good as the fill's timing").
--
-- ⚠ `computed_mpg` IS DELIBERATELY NOT RETURNED. It equals `miles_since_last / gallons` on 95.7% of
-- production rows, so a caller using it to estimate burn would recover only "this fill's gallons" —
-- the fill-to-full assumption this fleet violates (it arrives at 33% and buys 78% of the empty space).
-- `vehicles.baseline_mpg` is the independent estimator and is what this returns; validated across 169
-- trucks against observed fuel-per-mile at 6.92 baseline vs 7.08 observed, mean absolute error 0.52.
--
-- ── CAPACITY IS RETURNED RAW, ON PURPOSE ─────────────────────────────────────────────────────────
-- Three columns, not one. `resolveCapacity` in `packages/shared` reconciles the entered figure with
-- the sensor-implied one and floors both at the largest corroborated observed fill, with a confidence
-- level — arithmetic that has been got wrong before and is tested where it lives. Re-implementing any
-- of it in SQL would put a second copy where no unit test reaches (F9's whole argument).
--
-- ── MEASURED, on production, 90-day window + 14-day lookback (0248's rule: numbers, not adjectives) ──
--     6,109 rows · Planning 4.0 ms · Execution 95.4 ms · shared hit 24,872, read 0
--     Index Scan on idx_ftxn_org_time, then vehicles by primary key — no sequential scan, and the
--     `fuel_business_date` CASE appears INLINED in the filter, which is the property D-FI1 protects.

create or replace function fuel_buy_fills(
  p_org  uuid,
  p_from date,
  p_to   date
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

revoke all on function fuel_buy_fills(uuid, date, date) from public;
grant execute on function fuel_buy_fills(uuid, date, date) to authenticated, service_role;
