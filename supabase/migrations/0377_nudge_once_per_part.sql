-- 0377 — one reminder per PART of the application, not one per invitation (APPLICATION-FLOW-V2-PLAN
-- Q-AW37 (b), owner 2026-09-27; C3c3a).
--
-- ── WHY 0232'S RULE HAS TO MOVE ────────────────────────────────────────────────────────────────
-- 0232 lets an invitation be nudged ONCE, ever (`where nudged_at is null`), and nothing clears the
-- stamp. That was right when the link was one form. Since D-AF1/AF4 the link is two visits weeks apart
-- — Part 1 (identity, licences, photos, the permissions) and, after the office's screening, Part 2 (the
-- §391.21 form) — and C3c3 adds a reminder for a driver who stalls in Part 1. Under 0232's rule that
-- reminder would spend the only one the invitation gets, and the driver who then stalls in Part 2,
-- with thirty minutes of work history typed, would never be asked back. The owner ruled one reminder
-- per part.
--
-- ── THE PART IS DERIVED, NOT STORED ────────────────────────────────────────────────────────────
-- A stamp EARLIER than `application_sent_at` was spent on Part 1: the office had not sent the form yet.
-- So an invitation may be nudged while it has no stamp, or while its stamp predates the form being
-- sent — and once nudged in Part 2 the stamp is later than the send and the rule closes for good.
-- No second column, because the two facts it would hold are already these two timestamps, and a
-- `part_one_nudged_at` beside them could disagree with them.
--
-- This holds only because `application_sent_at` is written once (0365: `coalesce(application_sent_at,
-- now())` — a second Send press keeps the first stamp). If a later migration ever re-stamps it, a
-- re-send would reopen the Part 2 reminder, and this comment is the place that says so.
--
-- ⚠ 0365 BACKFILLED `application_sent_at` from `releases_completed_at`, so a pre-AF4 stamp could sit
-- before a backfilled send and read as a Part 1 reminder. Measured in production on 2026-09-27 before
-- writing this: 0 invitations are nudged with `nudged_at < application_sent_at`, so the change reopens
-- nobody.
--
-- ── WHAT IS NOT HERE ───────────────────────────────────────────────────────────────────────────
-- Who is stalled in Part 1 is the pure fold's decision (`packages/shared/src/applicationNudge.ts`),
-- as 0232's header argues for every rule about somebody's inbox; this function keeps only the guards
-- that make a read-then-write safe. Shipped ALONE, before its reader (`lint:migration-ordering`,
-- MIGRATION-DISCIPLINE §the-deploy-window): today's sweep reads only unstamped invitations and calls
-- this with the same arguments, so until C3c3b lands nothing it does changes.
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
     and (nudged_at is null
          or (application_sent_at is not null and nudged_at < application_sent_at))
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
  'A10 + Q-AW37 (0377): rotate an abandoned invitation''s token, extend its expiry and stamp nudged_at, in one transaction — once in Part 1 and once in Part 2, the part derived from whether the stamp predates application_sent_at. Returns false when the invitation was submitted, revoked, expired or already nudged in this part between the sweep reading it and this call.';

comment on column public.application_invitations.nudged_at is
  'A10: when the abandonment sweep last asked this driver back. Once per part (0377, Q-AW37): a stamp earlier than application_sent_at was the Part 1 reminder and leaves the Part 2 one open; a stamp after it closes the invitation for good. Never cleared. Set in the same transaction as the token rotation.';
