-- FuelGuard — 0081 WP6: real weather on fills + per-fill gating surface (docs/plans/WP6-MPG-BASELINE-SPEC.md)
-- ambient_temp_f: Open-Meteo-backfilled temperature at the fill (weather_cache reuse). Drives the
--   cold-weather MPG derate off REAL cold instead of calendar months (calendar stays the fallback).
-- case_gates: which rules were INELIGIBLE for this fill and why (tank sensor / odometer source / fill
--   size) — so limited detection is visible on the fill instead of a silent absence of alerts.
alter table fuel_transactions add column if not exists ambient_temp_f numeric(6,1);
alter table fuel_transactions add column if not exists case_gates jsonb;
