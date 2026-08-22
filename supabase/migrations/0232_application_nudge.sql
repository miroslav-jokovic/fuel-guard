-- 0232 — the one email that asks a driver to come back (APPLICATION-SYSTEM-PLAN A10, D-APP15).
--
-- ── ⚠ THE STEP'S TEXT CANNOT BE FOLLOWED AS WRITTEN, AND THIS IS THE REPAIR ────────────────────
-- A10 says: send "your application is saved — here is your link back". There is no link to send. The
-- invitation token is 256 bits of entropy that this table stores ONLY as a SHA-256 (0220), the
-- plaintext is returned once at mint time and never again, and the whole security posture of the
-- public application surface rests on that: a leak of `application_invitations` yields hashes and
-- timestamps, not working links. A scheduler cannot reconstruct what nobody kept.
--
-- The repo's existing answer to a lost link is `applicationInvites.ts`: "A lost link is replaced by a
-- NEW invitation, and the old one is revoked." ⚠ That answer is wrong HERE, and the reason is the
-- whole point of the feature: `application_drafts` is one row per invitation, so a new invitation
-- resumes an EMPTY form. An email promising a driver their saved application, whose link then shows
-- them a blank one, is worse than sending nothing.
--
-- So the token is ROTATED IN PLACE. Same invitation row — same draft, same phase stamps, same signed
-- releases — and a fresh hash. The alternative considered and rejected was sealing a copy of the
-- token with secretBox (as `driver_applications.ssn_sealed` does): it would let the SAME link be
-- re-sent, at the cost of making a table leak plus a key leak yield working links. Rotation keeps
-- 0220's property exactly as written and costs one thing instead: a driver who digs out the ORIGINAL
-- email after being nudged gets the neutral "this link is not valid" refusal. The nudge copy says so
-- in as many words, and the newer email is the one in front of them.
alter table public.application_invitations
  add column if not exists nudged_at timestamptz;

comment on column public.application_invitations.nudged_at is
  'A10: when the abandonment sweep emailed this driver their link back. Stamped ONCE and never cleared — a recruiting system that emails an applicant every six hours is one whose mail gets filtered. Set in the same transaction as the token rotation, so a nudge that failed to stamp cannot re-send.';

-- ── THE NUDGE, AS ONE TRANSACTION ──────────────────────────────────────────────────────────────
-- Rotate the hash, extend the expiry, stamp `nudged_at` — together, or not at all. Apart they are
-- three ways to lose: a rotated token nobody was emailed locks the driver out of their own draft; a
-- stamp without a rotation sends a link that is about to expire; an extension without a stamp lets
-- the next sweep do it all again.
--
-- Guarded on its own preconditions inside the transaction rather than trusting the caller's fold. The
-- sweep reads candidates and then sends mail, and a driver who submits in that window must not be
-- nudged — `where nudged_at is null and submitted_at is null and revoked_at is null` is what makes
-- the read-then-write safe without a lock the sweep would otherwise have to hold across an SMTP call.
--
-- `greatest(expires_at, ...)` never SHORTENS a link. A recruiter who deliberately issued a 60-day
-- invitation does not have it cut to 14 by a reminder.
create or replace function public.nudge_application_invitation(
  p_org         uuid,
  p_invitation  uuid,
  p_token_hash  text,
  p_extend_days int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  update public.application_invitations
     set token_hash = p_token_hash,
         expires_at = greatest(expires_at, now() + make_interval(days => p_extend_days)),
         nudged_at  = now()
   where id = p_invitation
     and org_id = p_org
     and nudged_at is null
     and submitted_at is null
     and revoked_at is null
     and expires_at > now();
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.nudge_application_invitation(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.nudge_application_invitation(uuid, uuid, text, int) to service_role;

comment on function public.nudge_application_invitation(uuid, uuid, text, int) is
  'A10: rotate an abandoned invitation''s token, extend its expiry and stamp nudged_at, in one transaction. Returns false when the invitation was submitted, revoked, expired or already nudged between the sweep reading it and this call — which is what makes the sweep safe to run without holding a lock across sending mail.';

-- ── THE OFFICE'S HALF ──────────────────────────────────────────────────────────────────────────
-- Same move as 0093, 0154 and 0207 before it: the vocabulary lives in
-- packages/shared/src/notificationsContract.ts and this CHECK mirrors it. The contract's test
-- iterates every category, and a category this CHECK rejects would fail the first emit in production,
-- so the two lists move together or not at all.
--
-- `application_stalled` is office-facing and mutable: a recruiter who works their pipeline from a
-- spreadsheet may silence the in-app copy, and nothing about a stalled application is urgent enough
-- to be non-mutable.
alter table public.notification_events drop constraint if exists notification_events_category_check;
alter table public.notification_events add constraint notification_events_category_check check (category in (
  'load_offered', 'load_changed', 'load_canceled', 'message_received',
  'duty_auto_closed', 'performance_week', 'training_due', 'system',
  'hazmat_review', 'hazmat_cleared', 'hazmat_rejected',
  'fuel_alert', 'declined_alert', 'efs_processing_failed', 'efs_feed_stale',
  'dq_expiring', 'dq_expired', 'dq_missing', 'dq_license_status', 'dq_mvr_received',
  'application_stalled'
));
