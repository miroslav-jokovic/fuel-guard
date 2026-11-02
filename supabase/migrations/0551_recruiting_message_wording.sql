-- 0551 — the carrier's own words in the messages an applicant is sent (HIRING-WORKFLOW-AUDIT-2026-10-31
-- §12 MT1, §8.2's "message templates (invitation, reminder, travel, videos)"). The reader is MT2; the
-- trip message's sender is MT3.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- Every email and text an applicant gets is a TypeScript function (`email.ts`, `applicationSentEmail.ts`,
-- `applicationNudgeSweep.ts`'s `nudgeEmail`, `orientationVideosContract.ts`, `smsConsentContract.ts`). A
-- carrier that wants to greet its drivers by name, say "call Dana at 555-0100 with any question", or
-- name its yard cannot, and the trip the office books (`applicant_travel`, 0376) is never sent to the
-- applicant at all — the recruiter reads it to them on the phone.
--
-- ── THE SHAPE (§12 D-MT2, D-MT5) ───────────────────────────────────────────────────────────────
-- `recruiting_message_wording`: one row per SAVE of one message's wording — the org, the message key,
-- the four parts a carrier may write (email subject, email heading, email paragraph, the text's lead
-- sentence; null = the product's words for that part), who saved it and when.
--
--   · **Append-only, newest wins.** A save is a new row, never an edit; "Use the standard wording" saves
--     a row of four nulls. So "what did we send this applicant on 11/04?" is answered by the newest row
--     saved before the send instant the product already records (`application_sent_at`, the nudge
--     stamps, `orientation_videos_sent_at`, `sms_outbox.sent_at`) — the words are derived from the
--     history, never stored a second time beside each send (D-MT6). MW010 refuses every UPDATE; MW011
--     every DELETE except the organization's own cascade.
--   · **The parts a rule needs are not here.** The link, its button, the expiry sentence, "your earlier
--     link no longer works", a text's leading carrier name and its rates / HELP / STOP lines stay in
--     code, outside anything a carrier can write (D-MT2). This table holds only free text.
--   · **The message keys are NOT a CHECK list** — they are the catalogue in TypeScript
--     (`RECRUITING_MESSAGES`, MT2), §10 D-CE3's rule: a key list in SQL would be a second catalogue. The
--     reader ignores a stored key the catalogue does not have. The CHECK below is the key's SHAPE only.
--   · **Lengths and line breaks are checked here** as well as in the PUT's schema, because a subject
--     line with a newline in it is a header injection whoever wrote the row. The GSM-7 rule on a text's
--     lead (D-MT4) is TypeScript's alone: it is a cost rule, not a safety one.
--   · **Not evidence**, not a driver's row: no `driver_id`, so nothing for the roster merge or the
--     applicant purge to move or delete, and not in `RETENTION_FORBIDDEN` (configuration history, a
--     handful of rows per carrier).
--   · **RLS on, no client policies** — deny-all from a browser; the API reads and writes with the
--     service role and filters on `org_id` itself (`expectOrgScoped` in MT2's tests).
--
-- ── AND THE TRIP TEXT'S REASON (§12 D-MT9) ─────────────────────────────────────────────────────
-- MT3 sends the booked trip by text through the outbox, which files each row under a `reason` (0376's
-- CHECK, last widened by 0539). `travel` is added here, one merge before its writer. The params carry
-- the trip's mode, times and confirmation — never a link (0376's `sms_outbox_params_check`, unchanged).
--
-- ⚠ DEPLOY WINDOW: a new table nobody reads yet, and a CHECK that only widens — old code meets neither.

create table if not exists public.recruiting_message_wording (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  message_key     text not null check (message_key ~ '^[a-z][a-z_]{0,39}$'),
  email_subject   text check (email_subject is null
                              or (length(btrim(email_subject)) between 1 and 120 and email_subject !~ '[\r\n]')),
  email_heading   text check (email_heading is null
                              or (length(btrim(email_heading)) between 1 and 120 and email_heading !~ '[\r\n]')),
  email_paragraph text check (email_paragraph is null or length(btrim(email_paragraph)) between 1 and 1000),
  text_lead       text check (text_lead is null
                              or (length(btrim(text_lead)) between 1 and 120 and text_lead !~ '[\r\n]')),
  saved_by        uuid references auth.users(id) on delete set null,
  saved_by_name   text not null check (length(btrim(saved_by_name)) between 1 and 200),
  saved_at        timestamptz not null default now()
);

alter table public.recruiting_message_wording enable row level security;

-- The two reads: a carrier's current wording (the newest row per key), and the wording in effect at an
-- instant (the newest row per key saved at or before it).
create index if not exists ix_recruiting_message_wording_latest
  on public.recruiting_message_wording (org_id, message_key, saved_at desc);

comment on table public.recruiting_message_wording is
  '§12 MT1 (0551): the carrier''s own wording for the messages an applicant is sent — one row per save, the newest per (org, message_key) wins; four nulls = the standard wording. Append-only (MW010/MW011). Keys are TypeScript''s catalogue (RECRUITING_MESSAGES), not a CHECK. Service-role only (RLS, no policies).';
comment on column public.recruiting_message_wording.email_subject is
  'Null = the product''s subject for this message. No line breaks (a subject is a mail header).';
comment on column public.recruiting_message_wording.email_heading is
  'Null = the product''s heading. The button, the link and the expiry sentence below it are never the carrier''s.';
comment on column public.recruiting_message_wording.email_paragraph is
  'Null = the product''s paragraph. Plain text; the sender escapes it.';
comment on column public.recruiting_message_wording.text_lead is
  'Null = the product''s lead sentence. The text keeps its carrier-name prefix, its link and its rates / HELP / STOP lines whatever this says; GSM-7 only (TypeScript, §12 D-MT4).';

create or replace function public.guard_recruiting_message_wording()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- The organization's own delete cascades here; by then its row is gone. Nothing else deletes.
    if not exists (select 1 from public.organizations o where o.id = old.org_id) then
      return old;
    end if;
    raise exception 'recruiting_message_wording is never deleted — save the standard wording instead'
      using errcode = 'MW011';
  end if;
  raise exception 'recruiting_message_wording is never edited — save a new wording instead' using errcode = 'MW010';
end;
$$;

drop trigger if exists trg_guard_recruiting_message_wording on public.recruiting_message_wording;
create trigger trg_guard_recruiting_message_wording
  before update or delete on public.recruiting_message_wording
  for each row execute function public.guard_recruiting_message_wording();

-- ── the trip text's reason (MT3) ───────────────────────────────────────────────────────────────
alter table public.sms_outbox drop constraint if exists sms_outbox_reason_check;
alter table public.sms_outbox add constraint sms_outbox_reason_check
  check (reason in ('nudge', 'application_sent', 'signing_link', 'drug_test_site', 'consent_confirm', 'invite',
                    'orientation_videos', 'travel', 'other'));
