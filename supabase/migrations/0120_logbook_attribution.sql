-- 0120: logbook-based fill attribution (WP-ATTR).
--
-- cumulative_overfuel false-fired when a driver changed trucks but a fill was booked to the OLD unit
-- (habit-typed unit number at the pump / stale card mapping): the wrong truck's 48h window collected
-- another truck's gallons while its odometer barely moved. The ELD LOGBOOK is the ground truth for
-- which truck a driver was in at any instant — Samsara's HOS logs carry the vehicle per entry; we were
-- already fetching them and dropping that field.
--
-- 1) hos_duty_segments learns its vehicle: the raw Samsara vehicle id from the log, plus our resolved
--    vehicles.id. Together the segments become a queryable driver→truck timeline.
-- 2) fuel_transactions carries the per-fill attribution verdict from verifyFillAttribution
--    ('confirmed' | 'suspect' | 'unknown') and the logbook truck when it contradicts the attributed one.
--    Suspect fills are excluded from the cumulative window / baseline math, and a suspect fill whose
--    attributed truck ALSO failed the GPS location match is auto-re-attributed to the logbook truck
--    (audit_logs action 'transaction.reattribute_vehicle').

alter table hos_duty_segments add column if not exists samsara_vehicle_id text;
alter table hos_duty_segments add column if not exists vehicle_id uuid;

comment on column hos_duty_segments.samsara_vehicle_id is
  'Samsara vehicle id the duty log entry was recorded in (the LOGBOOK truck, WP-ATTR). Null = not in the log.';
comment on column hos_duty_segments.vehicle_id is
  'Resolved vehicles.id for samsara_vehicle_id at sync time. Null = unresolved.';

-- The attribution verifier looks up a driver''s segments around a fueling instant.
create index if not exists idx_hos_seg_driver_time
  on hos_duty_segments (org_id, driver_id, started_at);

alter table fuel_transactions add column if not exists attribution_verdict text;
alter table fuel_transactions add column if not exists logbook_vehicle_id uuid;

comment on column fuel_transactions.attribution_verdict is
  'Logbook check of the fill''s vehicle attribution (WP-ATTR verifyFillAttribution): confirmed = ELD logbook agrees; suspect = logbook shows a different truck (fill excluded from window/baseline math); unknown = no driver/logbook coverage. Null = not yet evaluated.';
comment on column fuel_transactions.logbook_vehicle_id is
  'The truck the driver''s ELD logbook shows at the fueling instant when it contradicts the attributed vehicle (verdict=suspect). Null otherwise.';
