-- 0587 — a retired ad's replacement can be activated on a live campaign, and the bell can say so
-- (ADS-CREATIVE-QUALITY-PLAN Q-AD68, ruled 2026-11-11; D-AD23).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- CQ9 (0581) retires a tired ad: one ad paused, the campaign keeps delivering. Nothing enters in its place, so a
-- campaign's set of concepts only shrinks. Q-AD68 composes ONE replacement, a person approves it, and it is published
-- into the campaign's existing ad set and turned on. Two things the database must know for that:
--
--   · `ads_actions.kind` gains `activate_ad`: the ledgered act of turning ONE new ad ACTIVE on a live campaign, keyed
--     per ad, so a retry after a crash finds its row. Making the ad itself is the publisher's `create_paused`, as
--     every ad has always been made.
--   · `notification_events.category` gains `ads_creative_refresh`: "a new concept awaits your approval on a running
--     campaign", and "no replacement could be made", to whoever gets `ads_creative_retired` (the alerts settings choose).
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- Both CHECKs restated whole (0581's kinds, 0584's categories), one value added to each. `ACTION_KINDS` and
-- `NOTIFICATION_CATEGORIES` move in the same PR; nothing WRITES either value until the next merge (the runner's
-- `refresh` step), so the CHECKs widen before any writer exists — 0581's order.
--
-- ⚠ DEPLOY WINDOW: widened CHECKs only. Old code never sends the new values; the first sender ships in a later merge.
--
-- cross-module-waiver: restates messaging's `notification_events` category CHECK to add one ads category, as every
-- new category has (0521, 0537, 0559, 0563, 0575, 0581, 0584); the contract moves with it.

alter table public.ads_actions drop constraint if exists ads_actions_kind_check;
alter table public.ads_actions add constraint ads_actions_kind_check check (kind in (
  'transition', 'create_paused', 'launch', 'pause', 'lower_budget', 'raise_budget',
  'change_area', 'archive', 'kill', 'external_change', 'rules_sync', 'connection_test',
  'reconcile', 'retire_ad', 'activate_ad'));

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
  'ads_lead_quality',
  'ads_creative_retired',
  'ai_assistant_budget',
  'ads_creative_refresh'
));
