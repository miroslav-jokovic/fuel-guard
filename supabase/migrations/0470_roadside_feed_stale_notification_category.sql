-- 0470 — the notification category for an FMCSA record that has stopped refreshing
-- (INSPECTION-CHALLENGE-PLAN §4.1 "Freshness", IC1c).
--
-- ── WHY ──────────────────────────────────────────────────────────────────────────────────────────
-- The roadside inspections list, the Operations tab's Roadside card and every challenge after them
-- read a projection of FMCSA's open data that the API fetches daily. If that fetch stops — Socrata
-- refusing us, a dataset id retired, our scheduler not running — every one of them keeps showing the
-- last good record, quietly, as if it were today's. §4.1 asks for an alert when our last successful
-- run is older than 36 h or FMCSA's own `rowsUpdatedAt` older than 72 h.
--
-- `roadside_feed_stale`: sent to the people who read the safety section, at most once a day per org
-- while the record is late. The CHECK widens here; the emitter follows in the next merge (0397's and
-- 0465's reasoning: a category the CHECK refuses would fail the emitter's insert on a database the
-- release has not migrated yet). Mirrors `NOTIFICATION_CATEGORIES` in
-- packages/shared/src/notificationsContract.ts; the two lists move together or not at all.
--
-- `efs_feed_stale` (0154) is the same idea for EFS and has never had an emitter — measured 2026-10-13,
-- no code sends it. This one ships with its emitter, in the next merge.

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
  'roadside_feed_stale'
));
