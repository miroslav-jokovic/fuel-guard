-- 0385 — M2, the applicant flow's cleanup migration (APPLICATION-FLOW-V2-PLAN §8.3; the cleanup ledger,
-- §8.6 items 2 and 5). Nothing here adds behaviour: it removes what 0376's overloads and D-AW16's
-- envelope left behind, now that nothing calls or reads it.
--
-- ── 1. THE OLD OVERLOADS (§8.6 item 2) ─────────────────────────────────────────────────────────
-- 0376 gave three functions a new signature BESIDE the old one, so a migration landing before its
-- reader broke nothing. Each old one is dropped here only once nothing calls it. Decided by reading
-- the call sites, not `pg_stat_user_functions`: production runs `track_functions = none`, so that
-- view reads 0 for every function (measured 2026-09-29).
--   · `record_packet_mark`, 11 arguments — the api has called the 13-argument one on every mark since
--     C2c (`applicationPacketMarks.ts`, `p_packet_version` + `p_adoption_id`).
--   · `record_driver_release`, 11 arguments — the api passes `p_adoption_id` on every permission
--     (`applicationReleases.ts`; null when the link has no adoption), which resolves to the 12.
--   · `save_application_draft`, 5 arguments — M2a (#1127) made `revision` required, so `saveDraft`
--     always calls the 6-argument, revision-checked save. ⚠ Merged only after M2a was verified live
--     on both services: a page served by the api before M2a could still send a save with no revision.
-- KEPT, because they are still called: the 12-argument `submit_driver_application` (the api omits
-- `p_call_summaries` when there are none, which resolves to it), and `record_applicant_identity`,
-- which has only ever had one signature. No SQL function calls any of the three dropped here
-- (production's `pg_proc`, 2026-09-29).
--
-- ── 2. THE SEPARATE HANDBOOK OPENING (§8.6 item 5) ─────────────────────────────────────────────
-- D-AW16: the envelope the office sends (`signing_opened_at`) opens the handbook. 0382 let it count
-- beside the office's second press (`handbook_signing_opened_at/_by`); C3s4b (#1121) retired that
-- press, its route and its button, and no TypeScript has read or written either column since.
-- Production, 2026-09-29: 0 invitations carry the old stamp. So:
--   · `handbook_marks_guard`'s HB023 reads the envelope alone;
--   · `application_invitations_handbook_order_check` keeps only its third clause, on the envelope —
--     its first two were about the old columns only ("opened only once filed", "opened names who");
--   · the two columns go, and `handbook_signing_opened_by`'s foreign key with them.
-- The audit action `compliance.handbook_signing_opened` is no longer written; its old rows are
-- evidence and stay.
--
-- ⚠ DEPLOY WINDOW: every change here removes something nothing reads, so it may be served against
-- either side of the merge (docs/MIGRATION-DISCIPLINE.md).

-- ── 1. The old overloads ─────────────────────────────────────────────────────────────────────
drop function if exists public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int);
drop function if exists public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int);
drop function if exists public.save_application_draft(uuid, uuid, uuid, jsonb, text);

comment on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid) is
  'P5 + A-5/D-AW15 (0376): refusals DR030..DR036 plus DR037 (an earlier mark on this link has a different non-null packet_version) and DR038 (p_adoption_id is not a live adoption of this invitation of this mark kind). Records packet_version and adoption_id. The only signature since 0385.';
comment on function public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int, uuid) is
  'A5 + D-AW15 (0376): refusals DR020..DR023 plus DR038 (p_adoption_id is not a live signature adoption of this invitation). Records adoption_id. The only signature since 0385.';
comment on function public.save_application_draft(uuid, uuid, uuid, jsonb, text, int) is
  'AW10 (0376): save the draft only if its stored revision equals p_expected_revision (0 = no draft yet), else DA041 draft_revision_conflict. Returns the new revision. The only signature since 0385.';

-- ── 2a. handbook_marks_guard: the envelope is the only opening ─────────────────────────────────
-- 0382's body with the old stamp taken out of the select and out of HB023. Everything else — HB011,
-- HB020..HB022, HB024 and 0380's purge branch — is copied unchanged.
create or replace function public.handbook_marks_guard()
returns trigger
language plpgsql
as $$
declare
  inv record;
begin
  if TG_OP = 'DELETE' and public.purging_applicant_invitation(old.invitation_id) then
    return old;
  end if;
  if TG_OP <> 'INSERT' then
    raise exception 'handbook_marks is append-only' using errcode = 'HB011';
  end if;

  select org_id, expires_at, revoked_at, submitted_at, signing_opened_at, handbook_filed_at
    into inv
    from application_invitations
   where id = new.invitation_id;

  if not found or inv.org_id <> new.org_id then
    raise exception 'handbook_invitation_not_found' using errcode = 'HB020';
  end if;
  if inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'handbook_invitation_unusable' using errcode = 'HB021';
  end if;
  if inv.submitted_at is null then
    raise exception 'handbook_application_not_filed' using errcode = 'HB022';
  end if;
  -- D-AW16: the envelope the office sent (`signing_opened_at`) opens the handbook (0382); since 0385
  -- it is the only opening.
  if inv.signing_opened_at is null then
    raise exception 'handbook_signing_not_opened' using errcode = 'HB023';
  end if;
  if inv.handbook_filed_at is not null then
    raise exception 'handbook_already_filed' using errcode = 'HB024';
  end if;
  return new;
end;
$$;

-- ── 2b. The order check: filed only once the envelope was sent ─────────────────────────────────
-- Replaced BEFORE the columns go, since its old clauses name them.
alter table public.application_invitations drop constraint if exists application_invitations_handbook_order_check;
alter table public.application_invitations add constraint application_invitations_handbook_order_check check (
  handbook_filed_at is null or signing_opened_at is not null
);

-- ── 2c. The columns ───────────────────────────────────────────────────────────────────────────
alter table public.application_invitations
  drop column if exists handbook_signing_opened_at,
  drop column if exists handbook_signing_opened_by;
