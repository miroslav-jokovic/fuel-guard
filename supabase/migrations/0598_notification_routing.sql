-- 0598 — notification routing: which alert goes to whom, by bell, email or text
-- (docs/plans/notifications/NOTIFICATION-ROUTING-PLAN.md NR2, built as step HT1 of
-- docs/plans/dispatch-loads/HOME-TIME-PLAN.md §3.6, D-HT14).
--
-- ── WHAT GAP ─────────────────────────────────────────────────────────────────────────────────────
-- The routing plan measured it on 2026-10-02 and nothing has changed since: who receives an alert is
-- decided in fourteen places five different ways, email is one carrier-wide address list, and no office
-- person has a phone number stored anywhere, so no alert can be texted to staff. The home-time alerts are
-- the first that must reach a chosen person on a chosen channel, so the storage the routing plan designed
-- is built here rather than a fifteenth private audience beside it.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────────
--   · **`notification_routes`** (D-NR2, D-HT15): alert × recipient × channel, on or off. A recipient is
--     a role, a person, or a relation the resolver works out per event ('marked_by', 'truck_dispatcher').
--     `recipient_key` is text for all three, so one unique key covers them; a person who is no longer an
--     active member is dropped by the resolver, not by a foreign key. **No row for an alert = the
--     catalogue's defaults** (`@silvicom/shared`), so a default is written once, in code, and an org that
--     never opened the page is not frozen on the defaults of the day it was created. `alert` is free
--     text checked by the API against that catalogue: a CHECK here would need a migration per alert.
--   · **`notification_contacts`** (D-NR5, D-HT17): a person's mobile number, confirmed by a 6-digit code
--     texted to it. Only the code's hash is stored. `verified_at` is the consent record (with the words
--     they agreed to); `stopped_at` is set when they reply STOP.
--   · **`notification_deliveries`** (D-HT19): one row per email or text queued for a person — the held
--     queue (`not_before`, for texts that wait for morning), the outcome, and what the Settings page
--     counts. The bell needs no row here: its record is `notification_events`.
--   · **The idempotency ledger stays the ledger (0432).** `queue_notification_delivery` claims each
--     item's key in `notification_dedupe_keys` as '<channel>:<key>' and queues only the items it claimed,
--     in one transaction. So this table can be pruned at 90 days like the inbox without re-arming an
--     alert, and a job that dies between "claimed" and "queued" is not a state that can exist.
--   · **`notification_channel_settings`**: the hours texts are held (D-HT18), minutes past midnight on
--     the carrier's clock. No column defaults; the default window is in `@silvicom/shared`.
--   · **RLS on, no client policies** on all four — the api reads and writes with the service role and
--     filters on `org_id` itself.
--
-- ── WHAT WAS REJECTED ────────────────────────────────────────────────────────────────────────────
-- Seeding default routes per org: a copy of the catalogue with a delay fuse. A dedupe unique key on the
-- deliveries table: it could then never be pruned, which is the defect 0432 removed from the inbox.
-- Adding the phone to `user_profiles`: that table is read through `org_member_directory()`, and an
-- unconfirmed number with a code hash beside it is not a profile fact.
--
-- ⚠ DEPLOY WINDOW: four new tables and one new function, nothing calls any of them yet; a widened CHECK
-- nothing writes yet (the three categories arrive in `NOTIFICATION_CATEGORIES` in this PR, and their
-- first sender in HT4).
--
-- Rollback: drop the function and the four tables; restore 0592's CHECK.

-- ── 1. routes ────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.notification_routes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  alert          text not null check (length(alert) between 1 and 80),
  recipient_kind text not null check (recipient_kind in ('role', 'user', 'relation')),
  recipient_key  text not null check (length(recipient_key) between 1 and 80),
  channel        text not null check (channel in ('bell', 'email', 'sms')),
  enabled        boolean not null,
  updated_by     uuid references auth.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  unique (org_id, alert, recipient_kind, recipient_key, channel)
);

alter table public.notification_routes enable row level security;

comment on table public.notification_routes is
  'NOTIFICATION-ROUTING-PLAN D-NR2 (0598): alert x recipient (role | user | relation) x channel, on or off. No row for an alert = the catalogue''s defaults. A person''s row beats their role''s. Service-role only (RLS, no policies).';

-- ── 2. a person's confirmed mobile number ────────────────────────────────────────────────────────

create table if not exists public.notification_contacts (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  phone           text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  code_hash       text,
  code_expires_at timestamptz,
  attempts        smallint not null default 0 check (attempts between 0 and 20),
  verified_at     timestamptz,
  stopped_at      timestamptz,
  consent_text    text,
  consent_version text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (org_id, user_id)
);
-- The inbound STOP: a text arrives with a number and no org.
create index if not exists ix_notification_contacts_phone on public.notification_contacts (phone);

alter table public.notification_contacts enable row level security;

comment on table public.notification_contacts is
  'NOTIFICATION-ROUTING-PLAN D-NR5 (0598): an office person''s mobile number for alerts. verified_at (a 6-digit code they typed, only its hash stored) is the consent; stopped_at is their STOP. Service-role only (RLS, no policies).';

-- ── 3. what was queued and sent ──────────────────────────────────────────────────────────────────

create table if not exists public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  alert               text not null check (length(alert) between 1 and 80),
  channel             text not null check (channel in ('email', 'sms')),
  destination         text not null check (length(destination) between 3 and 320),
  title               text not null check (length(title) between 1 and 200),
  -- [{ "key": "<dedupe key>", "line": "<one sentence>" }], only the items this row claimed.
  items               jsonb not null check (jsonb_typeof(items) = 'array'),
  status              text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  skip_reason         text,
  not_before          timestamptz,
  attempts            smallint not null default 0,
  last_error          text,
  provider_message_id text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
-- The sender's sweep: what is due to go out, oldest first.
create index if not exists ix_notification_deliveries_queued
  on public.notification_deliveries (created_at) where status = 'queued';
-- The Settings page's 30-day counts and the retention scan.
create index if not exists ix_notification_deliveries_org_created
  on public.notification_deliveries (org_id, created_at);

alter table public.notification_deliveries enable row level security;

comment on table public.notification_deliveries is
  'HOME-TIME-PLAN D-HT19 (0598): one row per email or text queued for a person: the held queue (not_before), the outcome, the count the Settings page shows. Not the dedupe — that is notification_dedupe_keys — so it is pruned at 90 days. Service-role only (RLS, no policies).';

-- ── 4. queue a delivery, claiming its items ──────────────────────────────────────────────────────

-- Claims each item's key for (org, person, channel) in the ledger and queues ONE delivery holding only
-- the items it claimed; null when every item had already gone to this person on this channel. One
-- transaction: an item is never claimed without being queued.
create or replace function public.queue_notification_delivery(
  p_org uuid,
  p_user uuid,
  p_alert text,
  p_channel text,
  p_destination text,
  p_title text,
  p_items jsonb,
  p_not_before timestamptz default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_fresh jsonb := '[]'::jsonb;
  v_claimed int;
  v_id uuid;
begin
  if p_channel not in ('email', 'sms') then
    raise exception 'notification_delivery_channel: % is not email or sms', p_channel using errcode = 'NR001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'notification_delivery_items: an array of {key, line} is required' using errcode = 'NR002';
  end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item ->> 'key', '') = '' or coalesce(v_item ->> 'line', '') = '' then
      raise exception 'notification_delivery_items: every item needs a key and a line' using errcode = 'NR002';
    end if;
    insert into public.notification_dedupe_keys (org_id, audience_user_id, dedupe_key)
    values (p_org, p_user, p_channel || ':' || (v_item ->> 'key'))
    on conflict do nothing;
    get diagnostics v_claimed = row_count;
    if v_claimed = 1 then
      v_fresh := v_fresh || jsonb_build_array(v_item);
    end if;
  end loop;
  if jsonb_array_length(v_fresh) = 0 then
    return null;
  end if;
  insert into public.notification_deliveries
    (org_id, user_id, alert, channel, destination, title, items, not_before)
  values
    (p_org, p_user, p_alert, p_channel, p_destination, p_title, v_fresh, p_not_before)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.queue_notification_delivery(uuid, uuid, text, text, text, text, jsonb, timestamptz) is
  'HOME-TIME-PLAN D-HT19 (0598): claim each item''s key as ''<channel>:<key>'' in notification_dedupe_keys and queue one delivery of the items claimed; null when none were new. NR001 channel, NR002 items. Service role only.';

revoke all on function public.queue_notification_delivery(uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.queue_notification_delivery(uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;

-- ── 5. the hours texts are held (D-HT18) ─────────────────────────────────────────────────────────

create table if not exists public.notification_channel_settings (
  org_id              uuid primary key references public.organizations(id) on delete cascade,
  sms_quiet_start_min smallint not null check (sms_quiet_start_min between 0 and 1439),
  sms_quiet_end_min   smallint not null check (sms_quiet_end_min between 0 and 1439),
  updated_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now()
);

alter table public.notification_channel_settings enable row level security;

comment on table public.notification_channel_settings is
  'HOME-TIME-PLAN D-HT18 (0598): the window in which alert texts are held, minutes past midnight on the carrier''s clock. No row = the default window in @silvicom/shared. Service-role only (RLS, no policies).';

-- ── 6. the bell's three categories (D-HT12) ──────────────────────────────────────────────────────
-- 0592's list restated whole, the three home-time alerts added; NOTIFICATION_CATEGORIES moves in this
-- PR and nothing writes the values until HT4.

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
  'home_time_return_due', 'home_time_overdue', 'home_time_truck_limit'
));
