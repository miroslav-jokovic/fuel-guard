-- 0122: performance indexes for the logbook lookups (perf finding, 2026-08).
--
-- pg_stat_statements showed the per-fill hos_duty_segments lookups averaging 100–226ms on a 915k-row
-- table. Two fixes ship together: the queries gained a LOWER started_at bound (code — turns the scan
-- into a tight index range), and the vehicle-keyed lookup (healMissingAttribution's driver-inverse
-- path) gets the index it never had. The driver-keyed index already exists (0120).

create index if not exists idx_hos_seg_org_vehicle_time
  on hos_duty_segments (org_id, vehicle_id, started_at);
