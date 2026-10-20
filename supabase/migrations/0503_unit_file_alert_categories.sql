-- 0503 — two notification categories for a truck's or trailer's file: a paper about to run out, and a
-- paper that has (UNIT-FILES-PLAN UF6a, D-UF1).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- Since UF2 the unit-files rollup (`getUnitFiles`, apps/api/src/modules/evidence/unitFiles.ts) judges
-- every truck and trailer against the equipment catalogue (annual inspection, registration, and the
-- UF1 kinds) with the same verdicts the driver file uses. A driver's paper that nears
-- its end rings the bell and sends an email (`dq_expiring` / `dq_expired`, dqAlerts.ts); a truck's
-- does not, so the only way an office learns a registration lapsed is to open the Vehicles page on
-- the right day, or to hear it from an officer at a scale. UF6b runs the same planner over the unit
-- rows inside the existing DQ alert timer; these are the categories it writes.
--
-- ── WHY THEIR OWN CATEGORIES, NOT `dq_expiring` / `dq_expired` ──────────────────────────────────
-- The DQ categories are the driver qualification file (§391.51) and go to the people who manage the
-- drivers section; these go to the people who manage equipment (`usersWhoManage("equipment")`). A
-- safety manager who works the DQ file may mute truck papers and keep driver ones, and the mute is
-- per category (0089). Filing them under `dq_*` would also put truck registrations under the
-- preference labelled "Qualification expirations", which is not what a reader of that switch means.
-- No `unit_file_missing`: UF6 names only these two, and a unit with no paper for an item is already
-- the Files column's red chip (UF4a); an absence alert is a decision the plan has not taken.
--
-- ── WIDENED ONE MERGE BEFORE ITS WRITER ─────────────────────────────────────────────────────────
-- 0397, 0465, 0483 and 0499's discipline: in a release the new code may meet a database that has not
-- migrated, and a value the CHECK refuses fails `emit_notification`'s insert — `notify()` swallows
-- that, so the office would silently hear nothing. Nothing writes these yet; the planner follows in
-- UF6b. Mirrors `NOTIFICATION_CATEGORIES` (notificationsContract.ts); the lists move together or not
-- at all (notificationCategoryCheck.test.ts reads the last CHECK and compares).

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
  'roadside_repair_due', 'roadside_report_needs_review',
  'unit_file_expiring', 'unit_file_expired'
));
