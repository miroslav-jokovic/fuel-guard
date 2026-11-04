-- 0563 — one more lead alert: leads have stopped reaching us on time (ADS-AGENT-BUILD-WORKFLOW.md D2d; the
-- progress log's "not done" on the 2026-11-03 backfill fix).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- A connection whose backfill keeps failing is a failed job on a list nobody reads, and until the webhook is
-- live the backfill is the only way a lead arrives. None of the lead or ads categories says this:
-- `ads_no_leads` is a campaign that spent with no lead, `ads_token_expiring` one cause among several, and
-- `lead_uncontacted` a person's delay, which the plan measures apart ("the second never excuses the first").
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- 0559's CHECK restated whole, plus `lead_intake_failing`. `NOTIFICATION_CATEGORIES` gains it in the same
-- PR; nothing writes it until the next merge (the alert sender), so the CHECK widens before any writer
-- exists: 0559's order.
--
-- cross-module-waiver: restates messaging's `notification_events` category CHECK to add one lead category,
-- as every new category has (0521 for chat, 0537 and 0559 for ads); the contract moves with it.
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
  'lead_new', 'lead_uncontacted', 'lead_intake_failing'
));
