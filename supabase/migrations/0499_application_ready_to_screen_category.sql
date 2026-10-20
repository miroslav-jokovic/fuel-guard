-- 0499 — a notification category for an applicant who has finished Part 1 and signed the permissions,
-- so the office is TOLD it is their move (APPLICATION-FLOW-V2-PLAN Q-AW56; application audit 2026-10-20).
--
-- ── WHY (measured on production, 2026-10-20) ────────────────────────────────────────────────────
-- Four invitations, two of which finished everything an applicant can do alone — consent, Part 1,
-- the documents, all six permissions — on 2026-10-01. Zero were screened. Both links expired on
-- 10-14 and 10-15 while waiting on the office, and nothing had said a word to anybody: the only
-- office-facing notification in the hiring module is `application_stalled`, which the nudge sweep
-- emits for an applicant who STOPPED, and the plan rules that waiting on the office is not
-- abandonment (A10). So the one moment the process hands the baton to the office is the one moment
-- the office is not told. This category is that tap on the shoulder: emitted once per invitation
-- when the last permission lands (`record_driver_release` stamps `releases_completed_at`), sent to
-- the people who manage the recruitment section, deep-linked to the board where the row already
-- reads "Order the driving record · waiting on you".
--
-- ── WHY ITS OWN CATEGORY, NOT `application_stalled` ─────────────────────────────────────────────
-- A stall is bad news about the applicant; this is good news about the office's queue. A recruiter
-- may mute the first while working their pipeline from a spreadsheet and still want the second, and
-- the mute is per category (0089). Filing it under `system` is refused for 0397's reason: `system`
-- is non-mutable and means the product talking about itself.
--
-- ── WIDENED ONE MERGE BEFORE ITS WRITER ─────────────────────────────────────────────────────────
-- 0397, 0465 and 0483's discipline: in a release the new code may meet a database that has not
-- migrated, and a value the CHECK refuses fails `emit_notification`'s insert — `notify()` swallows
-- that, so the office would silently hear nothing. The emitter, the contract entry and the board's
-- "ready to screen" projection follow in the next merge. Mirrors `NOTIFICATION_CATEGORIES`
-- (notificationsContract.ts); the lists move together or not at all.

alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled', 'application_ready_to_screen',
  'card_status_changed',
  'drug_alcohol_result',
  'roadside_feed_stale',
  'medstop_connection',
  'roadside_repair_due', 'roadside_report_needs_review'
));
