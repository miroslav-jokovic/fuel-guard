-- 0335: the planner's tank and station rules become columns the settings page can hold (FP3 of
-- docs/plans/fuel/FUEL-PLANNING-PRECISION-PLAN.md, D-FP3 and D-FP6, owner ruling 2026-09-10).
--
-- ── WHY FIVE COLUMNS, AND WHERE EACH NUMBER LIVED UNTIL NOW ─────────────────────────────────────
-- `resolveRouteFuelConfig` has read `refuel_band_miles`, `critical_fuel_pct` and
-- `opposite_side_access_miles` off this row since the fewest-stops policy of 2026-07-21 (b3143c4), and
-- no migration ever created them — 0058, 0061, 0062, 0063, 0065 and 0325 add other things — so every
-- org has planned on the code defaults and the settings page has had nothing to show. Two more rules
-- were constants: `usableFraction = 0.95` in truckState.ts, which is the "fill to ~95%" the owner
-- rejected on 2026-09-10 ("fueled when it gets to 20% to the top"), and `BORDER_TOP_OFF_PCT = 80` in
-- fuelPlanning.ts, whose own solver comment said 85. Measured on unit 748's plan of 2026-09-10
-- (fuel_plans 67093503…) in the plan's §1.3.
--
-- Defaults are the values production has been planning on, except the fill target, which is the
-- owner's ruling: 100. `reserve_pct` keeps its column and its number; FP4 changes what it is a
-- percentage OF — the tank, i.e. the gauge, rather than "usable" (95% of the tank) — which moves the
-- one configured org's reserve from 19% to 20% of the gauge. Said here so nobody discovers it.
--
-- ── TWO DEFAULTS THE TABLE AND THE CODE DISAGREED ON ────────────────────────────────────────────
-- `always_fill_full`: 0061 set the column default to false (min-drawdown as the default policy);
-- d03b80e (2026-07-21) set the code default back to true; production's one row is true. D-FP3 retires
-- min-drawdown outright — every planned fill is full — so the column default follows the code and the
-- ruling. The column stays (the Buy-discipline tab still reads it) until FP6 retires that reading.
-- `price_ttl_hours`: 0058 said 30; the code has said 72 since the Pilot daily report proved it lags a
-- day or two; production is 72. The column follows the code.
--
-- ── ⚠ NO READER IN THIS MERGE ───────────────────────────────────────────────────────────────────
-- A merge is served ~3 minutes before its migration is applied (`lint:migration-ordering`,
-- docs/MIGRATION-DISCIPLINE.md §the-deploy-window). FP4 adds the readers in the next merge, after
-- `pnpm verify:live` reports this schema as current.
--
-- Rollback:
--   alter table route_fuel_settings
--     drop column fill_target_pct, drop column refuel_band_miles, drop column critical_fuel_pct,
--     drop column opposite_side_access_miles, drop column border_top_off_pct;
--   alter table route_fuel_settings alter column always_fill_full set default false;
--   alter table route_fuel_settings alter column price_ttl_hours set default 30;

alter table route_fuel_settings
  add column if not exists fill_target_pct            numeric not null default 100,
  add column if not exists refuel_band_miles          numeric not null default 150,
  add column if not exists critical_fuel_pct          numeric not null default 10,
  add column if not exists opposite_side_access_miles numeric not null default 2,
  add column if not exists border_top_off_pct         numeric not null default 80;

-- Bounds, so a typo is refused rather than planned on. A fill target under 50% would make every
-- stop a splash; a reserve is bounded at 50 by the form already; a critical threshold above the
-- reserve would call every planned stop an emergency, so it is capped at 50 and FP4's reader also
-- clamps it below the reserve.
alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_fill_target_pct_range;
alter table route_fuel_settings
  add constraint route_fuel_settings_fill_target_pct_range
  check (fill_target_pct >= 50 and fill_target_pct <= 100);

alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_refuel_band_miles_range;
alter table route_fuel_settings
  add constraint route_fuel_settings_refuel_band_miles_range
  check (refuel_band_miles >= 0 and refuel_band_miles <= 1000);

alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_critical_fuel_pct_range;
alter table route_fuel_settings
  add constraint route_fuel_settings_critical_fuel_pct_range
  check (critical_fuel_pct >= 0 and critical_fuel_pct <= 50);

alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_opposite_side_access_miles_range;
alter table route_fuel_settings
  add constraint route_fuel_settings_opposite_side_access_miles_range
  check (opposite_side_access_miles >= 0 and opposite_side_access_miles <= 25);

alter table route_fuel_settings
  drop constraint if exists route_fuel_settings_border_top_off_pct_range;
alter table route_fuel_settings
  add constraint route_fuel_settings_border_top_off_pct_range
  check (border_top_off_pct >= 0 and border_top_off_pct <= 100);

alter table route_fuel_settings alter column always_fill_full set default true;
alter table route_fuel_settings alter column price_ttl_hours set default 72;

comment on column route_fuel_settings.fill_target_pct is
  'Every planned fill tops the tank up to this % of its capacity. 100 = to the top (owner ruling 2026-09-10). Replaced the 0.95 usableFraction constant (0335, FP3).';
comment on column route_fuel_settings.refuel_band_miles is
  'A fuel stop is placed only in the last N miles of range above reserve, so the tank runs down and the trip has the fewest stops (0335, FP3; read by the code since b3143c4).';
comment on column route_fuel_settings.critical_fuel_pct is
  'At or below this % of tank with no preferred station reachable, a stop is a true EMERGENCY at the nearest pump; above it, a non-preferred stop is off-network (0335, FP3).';
comment on column route_fuel_settings.opposite_side_access_miles is
  'Extra detour miles charged to a station on the opposite side of a divided highway. 0 = off (0335, FP3).';
comment on column route_fuel_settings.border_top_off_pct is
  'Top the tank off at the last preferred station before an avoided or fuel-before state unless the truck would already cross the line at or above this % (the California rule; 0335, FP3).';
comment on column route_fuel_settings.reserve_pct is
  'Safety floor the planner never crosses, as a % of the TANK — the number on the gauge — since FP4 (0335). Before that it was a % of a 95% "usable" fraction, i.e. one point lower on the gauge.';
