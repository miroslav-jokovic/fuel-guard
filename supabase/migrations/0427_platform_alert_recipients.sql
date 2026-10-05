-- Silvicom 360 — 0427 platform_alert_recipients: who hears a PLATFORM alarm.
-- RELEASE-TRAIN-PLAN Q-REL4 (answered 2026-10-05) and DATA-LIFECYCLE-PLAN Q9 (opened 2026-09-22).
--
-- Every alarm in this repo used to address an org's office. Two kinds cannot: the nightly release's
-- outcome (shipped / failed / rolled back) and a platform check such as the partition-maintenance
-- state — no carrier can act on either, and there is no org to send them to. This is the one list
-- they go to: email addresses and phone numbers the platform owners keep in the console's Settings,
-- added and removed there without a deploy or a repository secret.
--
-- A removal is a stamp, not a DELETE: who stopped hearing production alarms, when, and by whose hand
-- is the question after a missed page, and the platform audit trail records the act besides.
--
-- Reader: scripts/release-notify.mjs, from GitHub Actions through Supabase's management API — on
-- purpose not through our API, because the message that matters most says the API is broken. If the
-- read fails, or finds no one on a channel, the workflow falls back to the RELEASE_NOTIFY_* secrets,
-- so this table can never be the reason a failed release goes unheard.

create table if not exists platform_alert_recipients (
  id               uuid primary key default gen_random_uuid(),
  channel          text not null check (channel in ('email', 'sms')),
  -- Normalised by admin-api before it gets here: an email lower-cased, a phone in E.164 (+1XXXXXXXXXX).
  -- The checks repeat the shape so a hand-written row cannot hold something no sender accepts.
  address          text not null check (
    (channel = 'email' and address = lower(address) and address ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
    or (channel = 'sms' and address ~ '^\+[1-9][0-9]{9,14}$')
  ),
  -- Who this is, for the person reading the list ("Miki — mobile"). Never sent anywhere.
  label            text check (label is null or length(label) <= 80),
  added_by         uuid references platform_admins(id) on delete set null,
  created_at       timestamptz not null default now(),
  removed_at       timestamptz,
  removed_by       uuid references platform_admins(id) on delete set null,
  -- removed_by may be null on a removed row (that admin was later deleted), never set on a live one.
  check (removed_by is null or removed_at is not null)
);

-- One live row per address and channel; a removed address may be added again later as a new row.
create unique index if not exists uq_platform_alert_recipients_live
  on platform_alert_recipients (channel, address) where removed_at is null;

alter table platform_alert_recipients enable row level security;
-- No client policies: only the service role (admin-api writes, the release workflow reads) reaches it,
-- like platform_admins (0070). A customer or anon role never sees who is paged about the platform.

comment on table platform_alert_recipients is
  'org: who hears a platform alarm (release outcome, platform checks). Written by admin-api; read by scripts/release-notify.mjs. Soft-removed (removed_at), never deleted.';
