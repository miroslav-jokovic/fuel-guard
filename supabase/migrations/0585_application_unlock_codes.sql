-- 0585 — a one-time code that opens a saved application when the date of birth will not
-- (APPLICATION-FIX-PLAN.md F0b; the F0 row "DOB typo locks driver out", owner 2026-11-09/11-10).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- A saved application opens to whoever holds the link only once they type the date of birth on file
-- (D-APP16). When the date ON FILE is wrong — a typo or a misread barcode in Part 1 — the driver's own
-- correct answer never matches. On the invite link they can try for ever and still never get in; on a
-- link the office sent for signing, five tries stop the link (D-AW14). Either way the only way out was a
-- call to the office. This lets the driver ask for a code sent to the invitation's own email (or text,
-- when they agreed to texts), and type it instead.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- One row per code SENT. Only the LATEST row for an invitation is ever checked, so sending another
-- code retires the last one without a write. Only a hash is stored; the six digits never leave the
-- email or the text they went in.
--   channel     where it went: `email` (the invitation's address) or `sms` (the number the driver agreed to
--               be texted on, `sms_consents`)
--   code_hash   sha-256, hex, of `<invitation id>:<code>` — salted by the invitation so one hash cannot be
--               looked up against another's
--   expires_at  ten minutes after it was sent (`UNLOCK_CODE_TTL_MINUTES`)
--   attempts    wrong codes typed against this row, counted by a conditional UPDATE; the fifth retires it
--   used_at     when the right code opened the application. The office's review drawer reads the latest
--               one to say "the date of birth on file did not match — check it" (Q-AM13's control)
--
-- ── RETENTION ──────────────────────────────────────────────────────────────────────────────────
-- 90 days from `created_at` (`RETENTION_RULES`): a code is dead after ten minutes, and the drawer's notice
-- matters while the application is being reviewed, which the 90-day draft prune already bounds. The
-- permanent record of each send and each use is `audit_logs`.
--
-- cross-module-waiver: none — recruiting's table, written and read by recruiting.
--
-- ⚠ DEPLOY WINDOW: a new table; old code neither reads nor writes it. New tables are exempt from the
-- column-then-reader ordering, so its writer ships in this merge.

create table if not exists public.application_unlock_codes (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  invitation_id  uuid not null references public.application_invitations(id) on delete cascade,
  channel        text not null check (channel in ('email', 'sms')),
  code_hash      text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at     timestamptz not null,
  attempts       integer not null default 0 check (attempts between 0 and 5),
  used_at        timestamptz,
  created_at     timestamptz not null default now(),
  check (expires_at > created_at),
  check (used_at is null or used_at >= created_at)
);
alter table public.application_unlock_codes enable row level security;
create index if not exists ix_application_unlock_codes_latest
  on public.application_unlock_codes (org_id, invitation_id, created_at desc);
create index if not exists ix_application_unlock_codes_age
  on public.application_unlock_codes (org_id, created_at);

comment on table public.application_unlock_codes is
  'F0b (0585): one-time codes a driver asks for when the date of birth on file will not open their saved application — emailed or texted, hashed, 10 minutes, 5 tries; only the latest per invitation counts. used_at tells the office the date on file did not match. Pruned at 90 days; audit_logs keeps the record.';
