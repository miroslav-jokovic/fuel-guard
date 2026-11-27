-- Silvicom 360 — 0651 broker mail P3-a: what the texts need from the database
-- (docs/plans/dispatch-loads/BROKER-MAIL-READER-PLAN.md §9 P3, D-BMR10; analysis §6.3, Q-BM7, Q-BM10–12)
--
-- P3 texts the dispatcher whose broker email sits unanswered past the company's time, and later sends
-- the backups the admin chose a short notice. The texts travel the road every alert text takes
-- (`queue_notification_delivery`, 0598). This migration adds only what that road cannot already hold.
--
-- ── 1. TWO ALERT CATEGORIES ──────────────────────────────────────────────────────────────────────
-- An alert's key is also its bell category (alertRouting.ts), and `notification_events` checks the
-- category. `broker_mail_waiting` is the dispatcher's own text and bell; `broker_mail_backup` is the
-- short notice to the dispatcher's backups. The list below is 0624's with the two appended.
--
-- ── 2. THE SWITCH IS A MOMENT, NOT A BOOLEAN ─────────────────────────────────────────────────────
-- `texts_on_since` is when an admin switched the texts on (null = off). Only an email received after
-- it can raise a text. As a boolean, the first minute after switching on would text every dispatcher
-- about every email still waiting from the last week. The backup notice's delay is its own column,
-- `backup_after_minutes` (Q-BM7 default +5). Both live on 0649's company row.
--
-- ── 3. THE BACKUPS ARE THE ADMIN'S LIST ──────────────────────────────────────────────────────────
-- Q-BM10, confirmed 2026-11-24: only an admin chooses a dispatcher's backups, on Settings › Broker
-- mail. Every change is audited by the API, and the dispatcher sees the list read-only. One row per
-- (dispatcher, backup). Nobody is their own backup. A person who leaves the company drops out because
-- the sender only texts current members (alertMemberCanReceive), so no trigger is needed here.
--
-- ── 4. A ROW REMEMBERS IT WAS TEXTED ABOUT ───────────────────────────────────────────────────────
-- `owner_alerted_at` / `backup_alerted_at` on `broker_mail_messages`: when 360 raised the dispatcher's
-- alert and the backups' notice for this email. The once-only promise is still the dedupe ledger's
-- (`queue_notification_delivery` claims each key). These stamps only keep the minute tick from asking
-- that ledger about every email that has waited all week, every minute. Written by the API's
-- broker-mail module only. The gateway's `mailgw_record_messages` inserts with `on conflict do
-- nothing` and names neither column, so it can never clear one.
--
-- ── WHY THE CODE FOLLOWS IN A SEPARATE MERGE ─────────────────────────────────────────────────────
-- Four new columns and a widened CHECK: their first reader and writer ship in P3-b, a separate merge
-- (`lint:migration-ordering`; the deploy window, MIGRATION-DISCIPLINE.md). Nothing existing reads or
-- writes any of it. The new table is exempt from the ordering rule.
--
-- cross-module-waiver: the only messaging object touched is `notification_events`' category CHECK,
-- widened by two words the way every new alert has widened it (0598, 0624); broker-mail writes nothing
-- of messaging's, and its texts go through messaging's own `queue_notification_delivery`.
--
-- Rollback: `drop table broker_mail_backups; alter table broker_mail_settings drop column
-- texts_on_since, drop column backup_after_minutes; alter table broker_mail_messages drop column
-- owner_alerted_at, drop column backup_alerted_at;` and restore 0624's category CHECK.

-- ── 1. the categories ───────────────────────────────────────────────────────────────────────────
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
  'broker_mail_waiting', 'broker_mail_backup'
));

-- ── 2. the company's text settings ──────────────────────────────────────────────────────────────
alter table public.broker_mail_settings
  add column if not exists texts_on_since timestamptz,
  add column if not exists backup_after_minutes int not null default 5 check (backup_after_minutes between 1 and 120);
comment on column public.broker_mail_settings.texts_on_since is
  '0651 (BROKER-MAIL-READER-PLAN P3): when an admin switched broker-mail texts on; null = off. Only an email received after it can raise a text, so switching on never texts the backlog.';
comment on column public.broker_mail_settings.backup_after_minutes is
  '0651 (Q-BM7): minutes after the dispatcher''s text that the backups get a short notice, if the email is still unanswered.';

-- ── 2b. the texted-about stamps ─────────────────────────────────────────────────────────────────
alter table public.broker_mail_messages
  add column if not exists owner_alerted_at timestamptz,
  add column if not exists backup_alerted_at timestamptz;
-- The tick's question every minute: "unanswered, not yet alerted, old enough" — on the waiting rows only.
create index if not exists broker_mail_messages_alert_due_idx
  on public.broker_mail_messages (org_id, received_at) where thread_state = 'waiting' and backup_alerted_at is null;

-- ── 3. each dispatcher's backups ────────────────────────────────────────────────────────────────
create table if not exists public.broker_mail_backups (
  org_id              uuid not null references public.organizations(id) on delete cascade,
  dispatcher_user_id  uuid not null references auth.users(id) on delete cascade,
  backup_user_id      uuid not null references auth.users(id) on delete cascade,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  primary key (org_id, dispatcher_user_id, backup_user_id),
  check (dispatcher_user_id <> backup_user_id)
);
alter table public.broker_mail_backups enable row level security;
comment on table public.broker_mail_backups is
  '0651 (BROKER-MAIL-READER-PLAN P3, Q-BM10): who gets the short notice when a dispatcher''s broker email stays unanswered. Set by an admin on Settings › Broker mail (audited); the dispatcher sees it read-only. Service-role only.';
