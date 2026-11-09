-- 0575 — one more ads alert: a campaign's leads are not real or not qualified (ADS-LEAD-QUALITY-PLAN LQ3a;
-- Q-AD51 ruled (a) 2026-11-09).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The monitor judges a campaign by what Meta can see in minutes: spend, leads, cost per lead, frequency
-- (`monitorChecks.ts`). Cost per lead rewards cheap junk: a campaign whose leads are wrong numbers or plainly
-- unqualified reads as the BEST campaign by that measure. What tells them apart is what happened when a
-- recruiter called — `recruiting_contacts.outcome = 'wrong_number'` and the lead's hard `does_not_meet`
-- verdicts — which nobody reads per campaign today. None of the existing categories says it:
-- `ads_no_leads` is spend with no lead at all, `lead_uncontacted` a lead nobody called.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- 0563's CHECK restated whole, plus `ads_lead_quality`. `NOTIFICATION_CATEGORIES` gains it in the same PR;
-- nothing writes it until the next merge (the monitor's check, LQ3b), so the CHECK widens before any writer
-- exists: 0559's and 0563's order. Q-AD51 ruled it an ALERT for the first weeks, so it is a category, not a
-- new monitor pause rule.
--
-- cross-module-waiver: restates messaging's `notification_events` category CHECK to add one ads category,
-- as every new category has (0521 for chat, 0537, 0559 and 0563 for ads and leads); the contract moves with it.
--
-- ⚠ DEPLOY WINDOW: a widened CHECK only. Old code never sends the new value; new code's first sender ships
-- in a later merge (`lint:migration-ordering`'s rule for a first reader, applied to a writer).

alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received', 'duty_auto_closed',
  'performance_week', 'training_due', 'system', 'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled', 'application_ready_to_screen', 'card_status_changed', 'drug_alcohol_result',
  'roadside_feed_stale', 'medstop_connection', 'roadside_repair_due', 'roadside_report_needs_review',
  'unit_file_expiring', 'unit_file_expired',
  'chat_mention', 'chat_reply',
  'ads_overspend', 'ads_rejected', 'ads_no_leads', 'ads_external_change', 'ads_token_expiring', 'ads_brief', 'ads_pause_failed',
  'lead_new', 'lead_uncontacted', 'lead_intake_failing',
  'ads_lead_quality'
));
