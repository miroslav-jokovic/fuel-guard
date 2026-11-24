-- 0643 — the record of every Pilot weekly bill email the API has read from the mailbox
-- (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §4, step 3; the owner ruled 2026-11-24 that the invoices are moved to
-- miki@'s `Pilot-Bills` folder automatically, with the PDF ATTACHED).
--
-- ── WHAT IS THE GAP ──────────────────────────────────────────────────────────────────────────────────
-- The weekly bill reaches the system only when somebody downloads the PDF and uploads it on Pilot invoices. That
-- happened nine Mondays in a row (9/02–11/09) and then stopped when Pilot changed the layout, and the statement
-- itself was never recorded once (every `fuel_recon_runs.statement_id` in production is null). A pull that reads
-- the folder and records the bill on the server takes the person out of the loop, and keeps a row for every email
-- so "did this week's bill arrive?" is answered in the app.
--
-- ── WHY ITS OWN TABLE AND NOT `pilot_price_mails` ────────────────────────────────────────────────────
-- 0635's table is the price feed's work record: its states (`expired`, `no_link`) and its `loaded` check
-- (effective date + prices) are a 48-hour link's. A bill is an attachment that never expires, and what it loads is
-- a statement, not prices. One table with two sets of meanings would have every reader filtering on a `kind`.
--
-- ── WHY THE SAME KEY ─────────────────────────────────────────────────────────────────────────────────
-- One row per email, keyed on its Message-ID (which, unlike Graph's id, survives a move between folders), for the
-- same reason as 0635: the owner reads these emails, so "unread" cannot mean "new", and the API never changes the
-- mailbox. Measured 2026-11-17: the same bill arrives forwarded by two people with identical PDF bytes, so
-- `file_sha256` lets the second email settle as `duplicate` without recording the bill twice.
--
-- ── STATES ───────────────────────────────────────────────────────────────────────────────────────────
--   recorded   — the bill is in `fuel_statements` (`statement_id`), checked against its own printed total
--   duplicate  — the same PDF bytes were already recorded from another email
--   refused    — the PDF was read and did not add up, or is not a Pilot bill; `error` says why. Final: the file
--                will not change (a corrected bill arrives as a new email)
--   failed     — Graph or the database failed; retried up to the run's attempt limit
--   no_pdf     — the email had no PDF attachment
--
-- A work record, not evidence: the evidence is `fuel_statements` and its stored PDF. A retry updates its row.
--
-- ⚠ DEPLOY WINDOW: a new table, nothing reads or writes it in this merge; the pull follows in the next one.
-- No client policies: deny-all to browsers on purpose; the API reads it with the service role.
--
-- Rollback: `drop table public.pilot_bill_mails`.

create table if not exists public.pilot_bill_mails (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  internet_message_id text not null check (length(internet_message_id) between 1 and 998),
  subject             text not null check (length(subject) <= 500),
  received_at         timestamptz not null,
  state               text not null check (state in ('recorded', 'duplicate', 'refused', 'failed', 'no_pdf')),
  attempts            integer not null default 1 check (attempts >= 1),
  file_name           text check (file_name is null or length(file_name) between 1 and 200),
  file_sha256         text check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$'),
  statement_id        uuid references public.fuel_statements(id) on delete set null,
  invoice_no          text check (invoice_no is null or length(invoice_no) between 1 and 60),
  period_start        date,
  period_end          date,
  error               text check (error is null or length(error) <= 2000),
  first_seen_at       timestamptz not null default now(),
  last_tried_at       timestamptz not null default now(),
  unique (org_id, internet_message_id),
  check (state <> 'recorded' or (statement_id is not null and file_sha256 is not null))
);

create index if not exists pilot_bill_mails_org_received on public.pilot_bill_mails (org_id, received_at desc);
create index if not exists pilot_bill_mails_org_sha on public.pilot_bill_mails (org_id, file_sha256) where file_sha256 is not null;

comment on table public.pilot_bill_mails is
  'Each Pilot weekly bill email the API read from the Pilot-Bills folder, and what became of it (PILOT-INVOICE-FORMAT-ANALYSIS-2026-11-24 §4).';

alter table public.pilot_bill_mails enable row level security;
