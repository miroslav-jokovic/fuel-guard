-- HazmatGuard notification categories (plan H7 deliverable 4). Extends the notification_events category
-- check so emit_notification() accepts the hazmat review/outcome categories:
--   hazmat_review   → a load became needs_review; sent to the org's trained reviewers.
--   hazmat_cleared  → a load was cleared;  sent to the submitting driver.
--   hazmat_rejected → a load was rejected; sent to the submitting driver (recapture / wrong document).
-- New categories ship ENABLED (absent from muted_categories = on), so no preferences backfill is needed.

alter table notification_events drop constraint notification_events_category_check;
alter table notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected'
));
