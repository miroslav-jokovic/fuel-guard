-- 0593 — an office correction and the row the driver is shown for it, in ONE transaction
-- (APPLICATION-FIX-PLAN.md §5 Q-AM14, owner 2026-11-11: (a)).
--
-- ── WHY ─────────────────────────────────────────────────────────────────────────────────────────
-- Five office doors change what an application says before the driver signs it: a draft correction
-- (`save_application_draft`), a Part 1 correction and a single Part 1 answer (`record_applicant_intake`),
-- an identity correction (`record_applicant_identity`, or Part 1's writer on a v2 link), and the SSN
-- replace (`record_applicant_ssn`). Each then wrote its `application_edits` rows (0337) as a SECOND
-- PostgREST call from `applicationEditLog.ts`. If that call failed, the change was on file and the
-- driver's screen 3.1 never showed it — the one thing D-AX13 exists to prevent — and a retry could not
-- repair it, because the next diff found nothing changed. The window was one insert wide, and it was
-- the signed document's honesty that fell through it.
--
-- ── WHY FOUR NEW FUNCTIONS, NOT A NEW ARGUMENT ON THE OLD FOUR ──────────────────────────────────
-- The plan's first sketch was an optional `p_edits` on each writer. Three reasons against it:
--   · every APPLICANT save goes through `save_application_draft` and `record_applicant_intake`, and
--     the applicant never writes an edit row. A correction is the office's act, with an actor and a
--     log; naming it as such keeps the applicant's path exactly as it is, byte for byte;
--   · adding a defaulted argument means drop-and-recreate (PGRST203, 0567's note), i.e. re-copying
--     0376's, 0588's, 0365's and 0589's bodies here — four places for the next reader to diff, and
--     four chances to change a writer this migration does not mean to change;
--   · a plpgsql call is already one transaction. A wrapper that calls the writer and then the log
--     gives exactly Q-AM14's property: if the log refuses, the write is rolled back with it.
-- So each `correct_*` function takes the writer's own arguments plus `p_edits` and `p_edited_by`,
-- calls the writer unchanged (every refusal code — DA041, AI001–AI009, SN001–SN003 — passes through
-- as it was), then `record_application_edits`. The old four keep their signatures and their callers.
--
-- ── THE EDIT ROWS ───────────────────────────────────────────────────────────────────────────────
-- `p_edits` is the API's `FactEditRow[]` as JSON: `{path, before, after, note, withheld}`. The shaping
-- rules are the ones `recordOfficeEdits` applied before this migration, moved here so there is one:
--   · a JSON null (or an absent key) is SQL NULL — "left blank" and "cleared" are real states (0337);
--   · a withheld row carries no value whatever the caller passed (0586's CHECK would refuse one, and
--     dropping them here means a caller's mistake costs nothing rather than the whole correction);
--   · `path` must be a JSON array, the contract path (0337). Anything else is AE001 and, being inside
--     the transaction, takes the correction with it.
-- An empty or null list writes nothing: an unchanged answer is not a correction the driver must read.
--
-- ── DEPLOY WINDOW ───────────────────────────────────────────────────────────────────────────────
-- New functions only; nothing existing is altered. The API calls them from the NEXT merge
-- (MIGRATION-DISCIPLINE.md §the-deploy-window), so code on either side of this migration works.

create or replace function public.record_application_edits(
  p_org        uuid,
  p_invitation uuid,
  p_edits      jsonb,
  p_edited_by  uuid
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_edits is null then
    return 0;
  end if;
  if jsonb_typeof(p_edits) <> 'array'
     or exists (select 1 from jsonb_array_elements(p_edits) e
                 where jsonb_typeof(e) <> 'object'
                    or jsonb_typeof(e -> 'path') is distinct from 'array') then
    raise exception 'application_edits_invalid' using errcode = 'AE001';
  end if;

  insert into public.application_edits (org_id, invitation_id, path, before, after, note, withheld, edited_by)
  select p_org,
         p_invitation,
         e -> 'path',
         case when w.withheld then null else nullif(e -> 'before', 'null'::jsonb) end,
         case when w.withheld then null else nullif(e -> 'after', 'null'::jsonb) end,
         -- 0586's CHECK refuses a blank reason (23514); the service requires one where Q-AM13 does.
         e ->> 'note',
         w.withheld,
         p_edited_by
    from jsonb_array_elements(p_edits) e
   cross join lateral (select coalesce((e ->> 'withheld')::boolean, false) as withheld) w;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.record_application_edits(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_application_edits(uuid, uuid, jsonb, uuid) to service_role;

comment on function public.record_application_edits(uuid, uuid, jsonb, uuid) is
  'Q-AM14 (0593): the one writer of application_edits rows from a JSON list of {path, before, after, note, withheld}. JSON null is SQL NULL; a withheld row is written with no values. AE001 when the list or a path is malformed. Called inside the correct_* functions so a correction and its rows commit together.';

-- ── The draft door (`editApplication`) ───────────────────────────────────────────────────────────
create or replace function public.correct_application_draft(
  p_org               uuid,
  p_invitation        uuid,
  p_driver            uuid,
  p_payload           jsonb,
  p_expected_revision int,
  p_edits             jsonb,
  p_edited_by         uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved jsonb;
begin
  -- `p_section` null: an office correction never moves how far the applicant has got.
  v_saved := public.save_application_draft(p_org, p_invitation, p_driver, p_payload, null, p_expected_revision);
  perform public.record_application_edits(p_org, p_invitation, p_edits, p_edited_by);
  return v_saved;
end;
$$;

revoke all on function public.correct_application_draft(uuid, uuid, uuid, jsonb, int, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.correct_application_draft(uuid, uuid, uuid, jsonb, int, jsonb, uuid) to service_role;

comment on function public.correct_application_draft(uuid, uuid, uuid, jsonb, int, jsonb, uuid) is
  'Q-AM14 (0593): the office''s draft correction. save_application_draft (refusals unchanged, DA041) and its application_edits rows in one transaction.';

-- ── The Part 1 doors (`correctApplicantPartOne`, `answerApplicantPartOne`, a v2 identity fix) ─────
create or replace function public.correct_applicant_intake(
  p_org          uuid,
  p_invitation   uuid,
  p_driver       uuid,
  p_intake       jsonb,
  p_licences     jsonb,
  p_endorsements text[],
  p_edits        jsonb,
  p_edited_by    uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Always the office's overwrite: the applicant's own Part 1 never goes through here.
  v_result := public.record_applicant_intake(p_org, p_invitation, p_driver, p_intake, p_licences, p_endorsements, true);
  perform public.record_application_edits(p_org, p_invitation, p_edits, p_edited_by);
  return v_result;
end;
$$;

revoke all on function public.correct_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], jsonb, uuid) from public, anon, authenticated;
grant execute on function public.correct_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], jsonb, uuid) to service_role;

comment on function public.correct_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], jsonb, uuid) is
  'Q-AM14 (0593): the office''s Part 1 correction. record_applicant_intake with p_overwrite = true (refusals unchanged, AI001-AI009) and its application_edits rows in one transaction.';

-- ── The identity door on a link without Part 1 (`correctApplicantIdentity`) ──────────────────────
create or replace function public.correct_applicant_identity(
  p_org        uuid,
  p_invitation uuid,
  p_driver     uuid,
  p_dob        date,
  p_cdl_number text,
  p_cdl_state  text,
  p_edits      jsonb,
  p_edited_by  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := public.record_applicant_identity(p_org, p_invitation, p_driver, p_dob, p_cdl_number, p_cdl_state, true);
  perform public.record_application_edits(p_org, p_invitation, p_edits, p_edited_by);
  return v_result;
end;
$$;

revoke all on function public.correct_applicant_identity(uuid, uuid, uuid, date, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.correct_applicant_identity(uuid, uuid, uuid, date, text, text, jsonb, uuid) to service_role;

comment on function public.correct_applicant_identity(uuid, uuid, uuid, date, text, text, jsonb, uuid) is
  'Q-AM14 (0593): the office''s identity correction. record_applicant_identity with p_overwrite = true (refusals unchanged, AI001-AI004) and its application_edits rows in one transaction.';

-- ── The SSN replace (`replaceApplicantSsn`) ──────────────────────────────────────────────────────
create or replace function public.correct_applicant_ssn(
  p_org        uuid,
  p_invitation uuid,
  p_driver     uuid,
  p_last4      text,
  p_sealed     text,
  p_edits      jsonb,
  p_edited_by  uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.record_applicant_ssn(p_org, p_invitation, p_driver, p_last4, p_sealed, 'office');
  perform public.record_application_edits(p_org, p_invitation, p_edits, p_edited_by);
end;
$$;

revoke all on function public.correct_applicant_ssn(uuid, uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.correct_applicant_ssn(uuid, uuid, uuid, text, text, jsonb, uuid) to service_role;

comment on function public.correct_applicant_ssn(uuid, uuid, uuid, text, text, jsonb, uuid) is
  'Q-AM14 (0593): the office''s SSN replace. record_applicant_ssn with entered_by = office (refusals unchanged, SN001-SN003) and its (withheld) application_edits row in one transaction.';
