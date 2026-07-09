-- ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- MANUAL DEPLOY — Phase 4: per-fill nearest-station distance (systematic wrong-pin detection, docs/12 §E)
-- Copy-paste this whole block into the Supabase SQL editor and run it. Safe to re-run (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────────────────────────────

alter table fuel_transactions add column if not exists samsara_nearest_station_miles numeric(7,1);

comment on column fuel_transactions.samsara_nearest_station_miles is
  'Truck GPS closest approach (mi) to the station pin that day. Clustering across a station''s fills flags a wrong pin (data error), suppressing a false location mismatch.';

-- Verify:
-- select id, location_text, state, samsara_location_confidence, samsara_nearest_station_miles
--   from fuel_transactions where samsara_nearest_station_miles is not null order by fueled_at desc limit 20;
