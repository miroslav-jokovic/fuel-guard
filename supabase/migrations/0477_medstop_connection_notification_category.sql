-- 0477 — the notification category for a Med-Stop connection that is about to stop, or has
-- (MEDSTOP-PLAN §7A.20).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
-- Safety › Drug & Alcohol, the DER's result alerts and the Med-Stop dispatch stop all read the hourly
-- sweep's mirror. Two things end that sweep silently:
--   · the API key expires — Med-Stop keys live at most 180 days, and an expired key answers the same
--     401 as a wrong one. Production's expires 2026-12-28 (measured 2026-10-15). Today the only
--     warning is a line on Settings › Med-Stop, a page nobody opens until something is wrong;
--   · the sweep fails or stops running — the page then shows a caution after two hours, to whoever
--     happens to open it, and nobody is told.
-- Either way a positive result would go unalerted and a violation would not stop dispatch, with every
-- screen still showing the last good read.
--
-- `medstop_connection`: sent to the admins who can paste a new key in Settings › Med-Stop. The CHECK
-- widens here; the emitter follows in the next merge (0465's and 0470's reasoning: a category the
-- CHECK refuses would fail the emitter's insert on a database the release has not migrated yet).
-- Mirrors `NOTIFICATION_CATEGORIES` in packages/shared/src/notificationsContract.ts; the two lists
-- move together or not at all.

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
  'medstop_connection'
));
