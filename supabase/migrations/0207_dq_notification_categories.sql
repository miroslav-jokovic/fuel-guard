-- 0207: the five driver-qualification notification categories (DQF execution plan C1)
--
-- Same move as 0093 and 0154 before it: the category vocabulary lives in
-- packages/shared/src/notificationsContract.ts and this CHECK mirrors it — the contract's test
-- iterates every category, and a category the CHECK rejects would fail the first emit in
-- production, so the two lists move together or not at all.
--
-- dq_expiring / dq_expired / dq_missing are our own clock (dqAlerts.ts, C2/C3);
-- dq_license_status / dq_mvr_received arrive with Phase E's SambaSafety webhook. All five are
-- office-facing (D-DQ13) and mutable — deliberately NOT in the non-mutable set.

alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received'
));
