-- 0624 — Lumper fees: the daily reminder's bell categories, and the switch that starts it
-- (docs/plans/dispatch-loads/LUMPER-REVISED-RC-PLAN.md LRC4, D-LRC4, D-LRC6, D-LRC7, D-LRC9).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The lumper cases exist (0600, 0601) and the page lists them, but nobody is told. The plan's daily
-- reminder goes to the order's dispatcher, accounting and the people the carrier chooses, by bell,
-- email and text, through the alert routing the home-time alerts built (0598, D-LRC7). Two things are
-- missing in the database for it: the bell's three categories, and a per-carrier switch.
--
-- ── WHY A SWITCH, AND WHY IT STARTS OFF ──────────────────────────────────────────────────────────
-- D-LRC9: two weeks of silent running before the first reminder. The cases are built and shown; each
-- day's list is compared with what billing actually did; reminders are switched on only when the list
-- has had no false case for a week. That is a person's decision on evidence, taken on a day nobody can
-- know in advance, so it is a row an admin writes from Settings, not a deploy. **No row = off**: a
-- carrier whose feed has just started is in its silent weeks by construction.
--
--   · `lumper_reminder_settings` — one row per carrier: `reminders_on`, who switched it and when. The
--     hour (08:00 on the carrier's clock) and the days (Monday to Friday) are Q-LRC2's ruling and live in
--     `@silvicom/shared` (`LUMPER_REMINDER_SCHEDULE`), the way home time's default window does; a column
--     for them would be a second copy of a ruling nobody has asked to change.
--   · `lumper_reminder_runs` — one row per carrier per day the reminder ran: the day is CLAIMED by
--     inserting the row before anything is sent, so two processes, or a restart at 10:00, send a morning
--     once (D-LRC6: one reminder per person per day). The counts are written after, and are what an
--     office asks first: "did it go this morning, and to how many?". A run that fails removes its claim,
--     and the next tick tries again; the dedupe ledger (0432) keeps a retried line from going twice.
--   · `notification_events.category` gains the three lumper alerts. 0598's list restated whole.
--
-- ── WHAT WAS REJECTED ────────────────────────────────────────────────────────────────────────────
-- An environment variable for the switch: it would be one answer for every carrier, changed by a
-- deploy, with no record of who decided. A column on `organizations`: that table is the org's identity,
-- and this is one feature's state with its own audit trail.
--
-- ⚠ DEPLOY WINDOW: new tables nothing reads until their code merges (exempt, root CLAUDE.md), and a
-- widened CHECK nothing writes until the reminder runs — which it does only for a carrier with a row
-- saying on, and no carrier has one.
--
-- Rollback: drop the two tables; restore 0598's CHECK.
--
-- RLS on, no client policies: the API reads and writes it with the service role and filters on org_id.

create table if not exists public.lumper_reminder_settings (
  org_id       uuid primary key references public.organizations(id) on delete cascade,
  reminders_on boolean not null,
  updated_by   uuid references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

alter table public.lumper_reminder_settings enable row level security;

comment on table public.lumper_reminder_settings is
  'LUMPER-REVISED-RC-PLAN D-LRC9 (0624): whether the daily lumper reminder is sent for this carrier. No row = off (the silent weeks). Written by an admin from Settings, audited. Service-role only (RLS, no policies).';

create table if not exists public.lumper_reminder_runs (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  run_on      date not null,                       -- the carrier's calendar day
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  cases       integer check (cases is null or cases >= 0),
  bells       integer check (bells is null or bells >= 0),
  emails      integer check (emails is null or emails >= 0),
  texts       integer check (texts is null or texts >= 0),
  primary key (org_id, run_on)
);

alter table public.lumper_reminder_runs enable row level security;

comment on table public.lumper_reminder_runs is
  'LUMPER-REVISED-RC-PLAN D-LRC6 (0624): one row per carrier per day the lumper reminder ran; inserted first as the claim on the day, counts written after. Service-role only (RLS, no policies).';

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
  'lumper_rc_waiting', 'lumper_rc_missing_billed', 'lumper_billing_gap'
));
