-- 0033: store WHEN the Samsara odometer reading was taken (the physical-fill anchor time).
-- samsara_odometer is now only populated when the reading is anchored to the actual fill (tank-rise
-- event, an at-station in-city stop, or GPS-confirmed proximity) — never a nearest-in-time stop off the
-- unreliable EFS clock. This column records that anchor instant so the odometer-mismatch view can prove
-- the reading really is "odometer at time of fueling" (and show coverage when it isn't).
alter table fuel_transactions add column if not exists samsara_odometer_at timestamptz;
