-- 0604 — a phone that proved the date of birth once is not asked for it again
-- (APPLICATION-FIX-PLAN.md U2, "the DOB unlock is asked once per device"; SCREEN-MAP §3).
--
-- ── WHAT THE GAP IS ───────────────────────────────────────────────────────────────────────────────
-- A saved application opens to whoever holds the link only once they type the date of birth on file
-- (D-APP16): the link travels by email and text, and a forwarded or gateway-scanned link must read
-- nothing. But the gate is asked on EVERY visit, of the driver on the phone that typed the date in the
-- first place: when they come back for their history, and again when they come back to sign. The
-- owner's walk of 2026-11-09 counted two of them on one application.
--
-- ── THE SHAPE ─────────────────────────────────────────────────────────────────────────────────────
-- One row per device the driver asked to be remembered, made only by a RIGHT answer (the date of birth
-- or the one-time code, 0585). The device keeps a random token; only its hash is stored here.
--   token_hash   sha-256, hex, of `<invitation id>:device:<token>` — salted by the invitation, so a
--                hash cannot be looked up against another's, and a token is worth nothing on another link
--   earned_by    which right answer made it: `date_of_birth` or `code`
--   expires_at   thirty days after it was made (`TRUSTED_DEVICE_TTL_DAYS`); the link's own expiry
--                still applies first, because the token is only ever checked on a link that resolves
--   last_used_at the last visit it opened
--
-- ⚠ A token is NOT a way in on its own: every check starts from a live link (`resolveInvitation`), so a
-- token without the link opens nothing and a link without the token is asked the date of birth, as
-- before. It answers "is this the phone that already proved it", and nothing else.
--
-- ── RETENTION ─────────────────────────────────────────────────────────────────────────────────────
-- 90 days from `created_at` (`RETENTION_RULES`): a row is dead at thirty, and `audit_logs` keeps the
-- record that a device was remembered.
--
-- cross-module-waiver: none — recruiting's table, written and read by recruiting.
--
-- ⚠ DEPLOY WINDOW: a new table; old code neither reads nor writes it. New tables are exempt from the
-- column-then-reader ordering, so the writer ships in the same merge. The writer fails soft where the
-- table is not there yet: nothing is remembered, and the date of birth is asked as it is today.

create table if not exists public.application_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invitation_id uuid not null references public.application_invitations(id) on delete cascade,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  earned_by text not null check (earned_by in ('date_of_birth', 'code')),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check (last_used_at is null or last_used_at >= created_at),
  unique (invitation_id, token_hash)
);

alter table public.application_trusted_devices enable row level security;

create index if not exists ix_application_trusted_devices_invitation
  on public.application_trusted_devices (org_id, invitation_id, created_at desc);
create index if not exists ix_application_trusted_devices_age
  on public.application_trusted_devices (org_id, created_at);

comment on table public.application_trusted_devices is
  'U2 (0604): a device the applicant asked to be remembered after a right date of birth or one-time code — a hashed random token, 30 days, checked only on a live link, so the same phone is not asked the date of birth again. Pruned at 90 days; audit_logs keeps the record.';
