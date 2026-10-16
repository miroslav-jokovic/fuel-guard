-- 0483 — the notification categories the repair record's next merge and the report alert write
-- (INSPECTION-CHALLENGE-PLAN IC11, IC14; D-IC14). The document kind is 0484 (another module's table).
--
-- Widened one merge before their writers (0397's and 0465's reasoning: in a release the new code may meet a
-- database that has not migrated, and a value the CHECK refuses fails the writer's insert):
--   · `roadside_repair_due` — a vehicle violation with no repair recorded and the 396.9(d) due day near or
--     passed; sent to the people who manage the maintenance section.
--   · `roadside_report_needs_review` — an officer's report whose check disagreed with the record (IC10's
--     `needs_review`); sent to the safety managers.
-- Mirrors `NOTIFICATION_CATEGORIES` (notificationsContract.ts); the lists move together or not at all.

alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled',
  'card_status_changed',
  'drug_alcohol_result',
  'roadside_feed_stale',
  'medstop_connection',
  'roadside_repair_due', 'roadside_report_needs_review'
));
