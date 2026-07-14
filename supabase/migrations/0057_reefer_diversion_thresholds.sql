-- 0057: reefer-diversion detection thresholds (Tier A). Flags a reefer-hauling truck that buys ULSD but
-- little/no reefer (ULSR) fuel over the window — the "select Ultra Low Sulfur, then fuel the reefer" pattern.
alter table anomaly_thresholds add column if not exists reefer_diversion_window_days     int     not null default 30;
alter table anomaly_thresholds add column if not exists reefer_diversion_min_tractor_gal numeric not null default 150;
alter table anomaly_thresholds add column if not exists reefer_diversion_max_reefer_gal  numeric not null default 0;
