-- 0118: sensor-measured tank capacity (WP-CAP capacity resolver).
--
-- The capacity every volume/over-fuel rule reconciles against used to be max(entered nameplate,
-- billed-gallons percentile) — both weak sources (a mistyped nameplate was the #1 false-critical
-- root cause, and billed history can be trained by the very theft it polices). The resolver adds a
-- PHYSICS source: per fill, implied capacity = billed gallons ÷ raw Samsara level-rise fraction;
-- the robust median over recent corroborated fills is stored here by the per-vehicle learner
-- (learnSensorCapacity → learnVehicleValues). It converges in ~5 reconciled fills, measures the true
-- COMBINED capacity of dual saddle tanks, and can correct an over-entered capacity DOWNWARD (stolen
-- gallons produce no rise, so billing alone can never train it).
--
-- Consumers: resolveCapacity() (rules 9/10/12 + the review-grade exceeds_capacity_unverified band),
-- capacityHealth (divergent entered-vs-measured records surfaced on Coverage + digest).

alter table vehicles add column if not exists sensor_capacity_gal numeric;
alter table vehicles add column if not exists sensor_capacity_samples integer;

comment on column vehicles.sensor_capacity_gal is
  'Sensor-measured (combined-effective) tank capacity, gallons — robust median of billed ÷ raw fuel-level rise over recent reconciled fills (WP-CAP learnSensorCapacity). Physics measurement; null until enough clustered observations.';
comment on column vehicles.sensor_capacity_samples is
  'Number of valid fill observations backing sensor_capacity_gal (transparency/UI).';
