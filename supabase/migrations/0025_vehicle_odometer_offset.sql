-- 0025: per-vehicle odometer offset (dash ↔ Samsara calibration).
-- The odometer_mismatch signal compares the driver-entered dash odometer against Samsara's OBD
-- odometer at fueling time. Many trucks read a constant amount apart (replaced cluster, OBD calibration),
-- which false-flags every fill. This offset (entered − samsara) is learned from the truck's own fills
-- and subtracted before flagging. source='manual' pins a human override the learner won't overwrite.
alter table vehicles add column if not exists odometer_offset        numeric(10,1) not null default 0;
alter table vehicles add column if not exists odometer_offset_source text          not null default 'auto'; -- 'auto' | 'manual'
