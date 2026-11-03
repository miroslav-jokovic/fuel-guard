-- 0556 — one more ads alert: an ad we tried to pause that is still not paused (2026-11-03 audit of the
-- ads and lead path, finding H2; ADS-AGENT-BUILD-WORKFLOW.md progress log, "audit fixes B").
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- A campaign in `pausing` is one we have decided must stop delivering: the kill switch, a person's
-- Pause, an auto-pause, or a launch that failed part-way at the platform. When the platform refuses the
-- pause (a revoked token, an account Meta disabled, a key this deploy cannot open), the runner retries
-- every minute and writes a failed `ads_actions` row each time, and nobody is told. The ad keeps
-- spending up to the platform's own caps. None of 0537's six ads categories says this: `ads_overspend`
-- is spend past a cap we measured, `ads_token_expiring` a connection near its end. A stuck pause is its
-- own fact, with its own recipients on Settings › Ads control (§4b "Alerts" reads the category list).
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- 0537 §12's CHECK restated whole, plus `ads_pause_failed`. `NOTIFICATION_CATEGORIES` gains it in the
-- same PR; nothing writes it until the next merge (the alert sender), so the CHECK widens before any
-- writer exists — 0521's and 0537's order.
--
-- cross-module-waiver: restates messaging's `notification_events` category CHECK to add one ads
-- category, as every new category has (0521 for chat, 0537 for ads); the contract moves with it.
--
-- ⚠ DEPLOY WINDOW: a widened CHECK only. Old code never sends the new value; new code's first sender
-- ships in a later merge (`lint:migration-ordering`'s rule for a first reader, applied to a writer).

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
  'lead_new', 'lead_uncontacted'
));
