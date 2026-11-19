-- 0635 — the record of every Pilot daily price email the API has handled (PILOT-PRICE-MAIL-PLAN §4).
--
-- ── WHAT IS THE GAP ──────────────────────────────────────────────────────────────────────────────────
-- Since 2026-11-11 Pilot sends the daily "Better Of" price quote as a 48-hour link instead of an attachment.
-- Nothing fetched it: the 2026-11-17 change fixed the READER for the new file ("Truck Diesel"), not the PULL,
-- so production's newest Pilot price stayed 11/10 while eight quotes sat in the mailbox, six of them past their
-- link's life by the time anyone looked (measured 2026-11-18). The API now reads the mailbox folder itself.
--
-- ── WHY A TABLE AND NOT "UNREAD" ─────────────────────────────────────────────────────────────────────
-- The EFS mailbox source marks a message read when it is done. The owner reads these emails in Outlook, so
-- every message was already read and an unread filter finds nothing. The API must not change the owner's
-- mailbox either. So it keeps its own record, one row per email, keyed on the email's Message-ID (which,
-- unlike Graph's id, survives a move between folders).
--
-- ── WHY EVERY OUTCOME IS A ROW ───────────────────────────────────────────────────────────────────────
-- "Is today's email in the system?" must be answerable from the app, not from a person reading logs. A link
-- that expired before it was fetched (`expired`), an email with no quote link (`no_link`) and a file that would
-- not load (`failed`, retried while the link lives) are each a row with their reason, beside the `loaded` ones.
--
-- ── WHY ONE ROW UPDATED IN PLACE ─────────────────────────────────────────────────────────────────────
-- This is a work record, not evidence: the prices themselves are kept in `fuel_prices` under the quote's own
-- Effective Date, and a re-load of the same file is a no-op there. A retry updates its row (`attempts`).
create table if not exists public.pilot_price_mails (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  internet_message_id text not null check (length(internet_message_id) between 1 and 998),
  subject             text not null check (length(subject) <= 500),
  received_at         timestamptz not null,
  state               text not null check (state in ('failed', 'loaded', 'expired', 'no_link')),
  attempts            integer not null default 1 check (attempts >= 1),
  effective_date      date,
  prices_loaded       integer check (prices_loaded is null or prices_loaded >= 0),
  sites               integer check (sites is null or sites >= 0),
  skipped_rows        integer check (skipped_rows is null or skipped_rows >= 0),
  geocode_pending     integer check (geocode_pending is null or geocode_pending >= 0),
  file_name           text check (file_name is null or length(file_name) between 1 and 120),
  file_sha256         text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  error               text check (error is null or length(error) <= 2000),
  first_seen_at       timestamptz not null default now(),
  last_tried_at       timestamptz not null default now(),
  unique (org_id, internet_message_id),
  check (state <> 'loaded' or (effective_date is not null and prices_loaded is not null))
);

-- The run reads an org's rows for the messages it just listed; the price drawer lists an org's newest.
create index if not exists pilot_price_mails_org_received on public.pilot_price_mails (org_id, received_at desc);

comment on table public.pilot_price_mails is
  'Each Pilot daily price email the API read from the mailbox, and what became of it (PILOT-PRICE-MAIL-PLAN).';

-- No client policy: written by the API's scheduler, read through the API, which org-filters (deny-all on purpose).
alter table public.pilot_price_mails enable row level security;
