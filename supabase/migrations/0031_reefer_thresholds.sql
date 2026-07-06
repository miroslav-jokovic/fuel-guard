-- 0031: reefer detection thresholds (Tier A). Max gallons/hour a reefer unit can plausibly burn, and the
-- reefer tank capacity to assume when a fill's trailer is unknown/unpaired. Both tunable in Settings.
alter table anomaly_thresholds add column if not exists max_reefer_burn_gph    numeric(5,2) not null default 1.5;
alter table anomaly_thresholds add column if not exists reefer_tank_default_gal numeric(7,2) not null default 50;
