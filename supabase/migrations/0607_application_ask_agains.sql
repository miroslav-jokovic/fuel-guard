-- 0607 — the office asks the driver one question again (APPLICATION-FIX-PLAN.md F5; owner's Q-AM1
-- ruling of 2026-11-11: "(a), a per-question 'ask again'").
--
-- ── WHAT THE GAP IS ───────────────────────────────────────────────────────────────────────────────
-- Once a driver sends their application, their page is a wait screen until the office approves it. The
-- office can correct an answer itself, and that is right for a typo. It cannot ASK: "which month did
-- you leave Old Carrier?" is a phone call today, and the answer is then typed by the office, on the
-- driver's behalf, into a document the driver will sign.
--
-- ── THE SHAPE ─────────────────────────────────────────────────────────────────────────────────────
-- One row per question asked.
--   path          which answer, as `application_edits.path` names one (0337): `["employers","<key>","ended_on"]`
--   question      the office's own words to the driver, 1 to 500 characters
--   asked_by      who asked (kept if the member is later removed: `set null`)
--   answered_at   when the driver sent their answer — set once, by the driver's link
--   withdrawn_at  when the office took the question back (it found the answer, or asked in error)
-- A question is OPEN while both are null. Never both: a withdrawn question cannot then be answered.
--
-- ── ONE OPEN QUESTION PER ANSWER ──────────────────────────────────────────────────────────────────
-- A partial unique index on (invitation, path) over open rows: asking twice about the same answer is a
-- double-click, not two questions for the driver to read.
--
-- ── RETENTION ─────────────────────────────────────────────────────────────────────────────────────
-- Kept with the application and deleted with its invitation (cascade), as `application_edits` is: it is
-- part of how the document came to say what it says. `audit_logs` records each ask, answer and
-- withdrawal permanently.
--
-- cross-module-waiver: none — recruiting's table, written and read by recruiting.
--
-- ⚠ DEPLOY WINDOW: a new table; old code neither reads nor writes it. New tables are exempt from the
-- column-then-reader ordering, so the office's writer ships in this merge.

create table if not exists public.application_ask_agains (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invitation_id uuid not null references public.application_invitations(id) on delete cascade,
  path jsonb not null check (jsonb_typeof(path) = 'array' and jsonb_array_length(path) between 1 and 3),
  question text not null check (length(btrim(question)) between 1 and 500),
  asked_by uuid references auth.users(id) on delete set null,
  asked_at timestamptz not null default now(),
  answered_at timestamptz,
  withdrawn_at timestamptz,
  withdrawn_by uuid references auth.users(id) on delete set null,
  check (answered_at is null or withdrawn_at is null),
  check (answered_at is null or answered_at >= asked_at),
  check (withdrawn_at is null or withdrawn_at >= asked_at)
);

alter table public.application_ask_agains enable row level security;

create unique index if not exists ux_application_ask_agains_open
  on public.application_ask_agains (invitation_id, path)
  where answered_at is null and withdrawn_at is null;
create index if not exists ix_application_ask_agains_invitation
  on public.application_ask_agains (org_id, invitation_id, asked_at);

comment on table public.application_ask_agains is
  'F5 (0607): one question the office sent back to the applicant about one answer (path as application_edits names it), in the office''s words. Open while answered_at and withdrawn_at are null; one open question per answer. Leaves with its invitation; audit_logs keeps each ask, answer and withdrawal.';
