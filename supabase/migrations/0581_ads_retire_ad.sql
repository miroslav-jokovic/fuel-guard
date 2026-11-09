-- 0581 — a tired ad can be retired (ADS-CREATIVE-QUALITY-PLAN CQ9; D-AD23).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The monitor's one answer to fatigue is `frequency_max`, which pauses the WHOLE campaign (B5b). Proven practice (plan
-- §1 R6) retires the tired AD — CTR fallen against its own first week, frequency up — and enters the next concept,
-- while the campaign and its other ads keep delivering. Two things the database must know for that:
--
--   · `ads_actions.kind` gains `retire_ad`: the ledgered act of pausing ONE ad at the platform, keyed per ad, so a
--     retry after a crash finds its row and the review screen can say "retired on the 12th: click-through fell 31 %".
--   · `notification_events.category` gains `ads_creative_retired`: the bell that says so, to whoever gets
--     `ads_no_leads` today (the alerts settings choose).
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
-- Both CHECKs restated whole (0537's kinds, 0575's categories), one value added to each. `NOTIFICATION_CATEGORIES` and
-- `ADS_ACTION_KINDS` move in the same PR; nothing WRITES either value until the next merge (the monitor's retire step,
-- CQ9b), so the CHECKs widen before any writer exists — 0559's, 0563's and 0575's order.
--
-- cross-module-waiver: restates messaging's `notification_events` category CHECK to add one ads category, as every
-- new category has (0521, 0537, 0559, 0563, 0575); the contract moves with it.
--
-- ⚠ DEPLOY WINDOW: widened CHECKs only. Old code never sends the new values; the first sender ships in a later merge.

alter table public.ads_actions drop constraint if exists ads_actions_kind_check;
alter table public.ads_actions add constraint ads_actions_kind_check check (kind in (
  'transition', 'create_paused', 'launch', 'pause', 'lower_budget', 'raise_budget',
  'change_area', 'archive', 'kill', 'external_change', 'rules_sync', 'connection_test',
  'reconcile', 'retire_ad'));

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
  'ads_creative_retired'
));
