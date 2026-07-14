-- 0056: idle-score basis for the driver grade. "intensity" (default) scores avoidable idle as a share of the
-- driver's ENGINE-ON time (drive + idle) — exposure-normalized and money-aligned, so it tracks ABSOLUTE
-- avoidable waste and is fair across mileage. "share" is the older discipline ratio (avoidable / own idle).
alter table driver_performance_settings
  add column if not exists idle_score_basis text not null default 'intensity';
