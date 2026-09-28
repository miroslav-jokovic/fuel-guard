-- 0378 — a third token, for texts only, so a text that carries the applicant's link can wait for its
-- window (APPLICATION-FLOW-V2-PLAN Q-AW29 (a), owner 2026-09-27).
--
-- ── WHAT IT FIXES ──────────────────────────────────────────────────────────────────────────────
-- A text outside the recipient's hours waits in `sms_outbox` (0376, C2d) — except the three that carry
-- a link: the reminder (0232), "your application is ready" (the office's Send, 0365) and the sign link.
-- Those go at once or not at all, because a link can only be minted by ROTATING the invitation's token,
-- and the Send and the reminder put that link on the office's screen and in an email at the moment they
-- run (D-AF7). A queued text that rotated `token_hash` again at drain time would kill the link the
-- driver had just been handed; 0376 refuses a URL in the outbox's params for the same reason (a stored
-- plaintext bearer token is what 0220 and 0232 refused). So today a Send pressed at 19:30 Central emails
-- the driver and texts them nothing, ever.
--
-- ── WHY A THIRD HASH, AND NOT A ROTATION OF ONE OF THE OTHER TWO ───────────────────────────────
-- `token_hash` is the email's link and the office's on-screen link; `sign_token_hash` is the signing
-- link (0345, 0369). Each is somebody's promise that "this link still works". A hash of the TEXT's own
-- is minted when the text is actually sent — at once, or by the drain hours later — and rotating it
-- kills only the previous TEXT's link, which is the one thing the text says ("this replaces the link
-- in my earlier text"). The email's link and the office's screen are untouched.
--
-- ── COLUMN AND WRITER ONLY. THE READER IS THE NEXT MERGE ───────────────────────────────────────
-- Railway serves a merge before `migrate.yml` has applied its schema (`lint:migration-ordering`,
-- docs/MIGRATION-DISCIPLINE.md §the-deploy-window), so `resolveInvitation` learns this column in the
-- merge after this one. Until then nothing writes it and nothing reads it.
--
-- ── NULLABLE, PARTIAL UNIQUE INDEX (0345's reasoning, unchanged) ───────────────────────────────
-- Null until the first link-bearing text is sent, which for most invitations is never. Unique because
-- the resolver looks an invitation up BY this hash, and two rows sharing one would make that lookup
-- answer "invalid link" to a driver holding a good one; partial because only rows that have a text
-- token are governed by it, and those are the only rows the lookup can match.
alter table public.application_invitations
  add column if not exists sms_token_hash text;

create unique index if not exists application_invitations_sms_token_hash_key
  on public.application_invitations (sms_token_hash)
  where sms_token_hash is not null;

comment on column public.application_invitations.sms_token_hash is
  'Q-AW29 (0378): SHA-256 of the THIRD token — the one a text carries. Minted when a link-bearing text is actually sent (at once, or when sms_outbox drains it), rotated by rotate_invitation_sms_token, which touches nothing else: token_hash (the email''s and the office''s link) and sign_token_hash keep working. Null until the first such text.';

-- ── THE ROTATION, AS ONE GUARDED STATEMENT ─────────────────────────────────────────────────────
-- Guarded inside the statement, not by the caller: the drain reads a queued row and then sends, and an
-- invitation revoked or lapsed in between must not be handed a working link. It does NOT extend
-- `expires_at` — a text is not a reminder, and a queued text that quietly lengthened a link's life
-- would be a decision nobody made. It does not refuse a submitted invitation either: the sign link is
-- texted after submission, and whether a queued text is still worth sending is the caller's question.
create or replace function public.rotate_invitation_sms_token(
  p_org        uuid,
  p_invitation uuid,
  p_token_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sms_token_hash_invalid' using errcode = '22023';
  end if;
  update public.application_invitations
     set sms_token_hash = p_token_hash
   where id = p_invitation
     and org_id = p_org
     and revoked_at is null
     and expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.rotate_invitation_sms_token(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.rotate_invitation_sms_token(uuid, uuid, text) to service_role;

comment on function public.rotate_invitation_sms_token(uuid, uuid, text) is
  'Q-AW29 (0378): set the invitation''s text-only token hash, replacing the previous text''s. Touches no other column — not token_hash, not sign_token_hash, not expires_at. Returns false for a revoked, lapsed or other-org invitation, so a text queued before any of those sends no link.';
