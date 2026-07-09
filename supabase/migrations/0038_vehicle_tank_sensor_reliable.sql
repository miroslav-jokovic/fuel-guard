-- LEARNED per-truck flag: does the Samsara fuel-level sensor's rise reflect the WHOLE billed fill?
-- Auto-calibrated from the observed-rise / billed-gallons ratio over recent fills (see
-- learnTankSensorReliability): a single-tank or crossover-equalized truck clusters near 1.0; a
-- dual-independent-tank truck (one sensor) runs ~0.5 or swings wildly. The tank-fill-short anomaly fires
-- ONLY when this is true, so a two-tank truck never produces a false "short". Defaults false (suppressed)
-- until enough history clusters. tank_fill_ratio stores the learned median ratio for transparency/UI.
alter table vehicles add column if not exists tank_sensor_reliable boolean not null default false;
alter table vehicles add column if not exists tank_fill_ratio       numeric(5,3);

comment on column vehicles.tank_sensor_reliable is
  'Learned: Samsara tank sensor reflects the whole billed fill (ratio ~1). Gates tank_fill_short. Default false.';
