-- Silvicom 360 — 0654 warning desk WD6-a: the bell's urgent follow-up category
-- (docs/plans/maintenance/WARNING-DESK-PLAN.md WD6, D-WD14)
--
-- The warning desk rings the bell only for an URGENT follow-up — a crash, a red STOP lamp, a panic
-- button (D-WD12). Everything else waits on the list: a desk is a list, not an alarm (D-WD14). The bell
-- writes `notification_events`, whose CHECK lists every category, so the one new word is added here.
-- The list below is 0651's with `follow_up_urgent` appended; no migration between 0651 and this one
-- redefines the CHECK.
--
-- ── WHY THE CODE FOLLOWS IN A SEPARATE MERGE ─────────────────────────────────────────────────────
-- A widened CHECK's first writer (`notify()` from `orchestration/warningDesk.ts`) ships in WD6-b, a
-- separate merge (`lint:migration-ordering`; the deploy window, MIGRATION-DISCIPLINE.md). Until it
-- lands nothing writes the category. The contract's `NOTIFICATION_CATEGORIES` gains the word in this
-- PR because `notificationCategoryCheck.test.ts` holds the contract and the latest CHECK equal.
--
-- cross-module-waiver: the only messaging object touched is `notification_events`' category CHECK,
-- widened by one word the way every new alert has widened it (0598, 0624, 0651); followups writes
-- nothing of messaging's, and its bell goes through messaging's own `notify()`.
--
-- Rollback: restore 0651's category CHECK (delete any `follow_up_urgent` rows first).

alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received', 'duty_auto_closed',
  'performance_week', 'training_due', 'system', 'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled', 'application_ready_to_screen', 'card_status_changed', 'drug_alcohol_result',
  'roadside_feed_stale', 'medstop_connection', 'roadside_repair_due', 'roadside_report_needs_review',
  'unit_file_expiring', 'unit_file_expired', 'chat_mention', 'chat_reply',
  'ads_overspend', 'ads_rejected', 'ads_no_leads', 'ads_external_change', 'ads_token_expiring', 'ads_brief',
  'ads_pause_failed', 'lead_new', 'lead_uncontacted', 'lead_intake_failing', 'ads_lead_quality',
  'ads_creative_retired', 'ai_assistant_budget', 'ads_creative_refresh', 'unit_note_mention',
  'home_time_return_due', 'home_time_overdue', 'home_time_truck_limit',
  'lumper_rc_waiting', 'lumper_rc_missing_billed', 'lumper_billing_gap',
  'broker_mail_waiting', 'broker_mail_backup',
  'follow_up_urgent'
));
