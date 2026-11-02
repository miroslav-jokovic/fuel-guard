-- 0550 — the carrier's required questions and the documents it asks for become settings
-- (HIRING-WORKFLOW-AUDIT-2026-10-31 §8.2 fourth and fifth items, §9.3, §11 S1). Reader: §11 S2.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- The seven questions an applicant must answer are a flag on `SILVICOM_DRIVER_V3` (§9 P8), and Part
-- 2's "Your documents" offers every capture slot (§9 P9). Neither is the carrier's to change: a carrier
-- that does not care how a driver heard about it, or never wants a passport photo, cannot say so, and
-- one that wants the references answered cannot either.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- · `recruiting_settings.required_questions text[]` — null = the product default, which is the
--   served definition's own `required` flags (D-RS1). Non-null is exactly the set required; an empty
--   array means nothing is.
-- · `recruiting_settings.offered_document_slots text[]` — null = every slot, P9's behaviour (D-RS6).
--   The licence and the medical card are always offered; that rule is the reader's, in TypeScript.
-- · `application_invitations.required_questions text[]` — the set THIS applicant is asked for,
--   stamped once at the office's first Send (D-RS3). Null = an invitation sent before this step, and it
--   reads exactly as today: the flags of the draft's own questionnaire version.
-- · `send_application_invitation` gains `p_required_questions text[] default null` and writes it only
--   while `application_sent_at` is still null. A resend (which rotates the link) never restamps.
--
-- ── WHY A STAMP ON THE INVITATION, NOT THE LIVE SETTING ────────────────────────────────────────
-- A question made required on Tuesday must not refuse, on Thursday, an applicant who answered the form
-- on Monday without being asked for it — the reason a draft carries `questionnaire_version` (§9 P8). A
-- carrier's setting is not a new version of the questions (the words are unchanged), so it cannot ride
-- that mechanism and needs its own snapshot, taken when the applicant is first served the form. The
-- Send is that moment. Documents are NOT stamped: offering fewer refuses nothing
-- (`APPLICATION_CAPTURE_REQUIRED` is empty), so the reader reads the live setting.
--
-- ── WHY THE API RESOLVES THE SET AND SQL ONLY STORES IT ────────────────────────────────────────
-- Which questions MAY be required (none asked only after another answer, never the EEO key) and what
-- the default is are facts of the questionnaire definition, which lives in TypeScript
-- (`questionnaireContract.ts`). A CHECK naming question ids, or SQL computing the default, would be a
-- second questionnaire — §10 D-CE3's rule. So the columns check SHAPE only (lower-case ids, at most 60,
-- no null element) and the reader ignores an id the definition does not have.
--
-- ── WHY NOT A ROW PER QUESTION ─────────────────────────────────────────────────────────────────
-- Nothing points at a required-question row and nothing about one has a history: the setting is one
-- value the office replaces whole, like `hidden_hiring_steps` (0545). The invitation's stamp is the
-- history that matters, and it is per applicant.
--
-- cross-module-waiver: `send_application_invitation` is recruiting's own function (0365, 0533);
-- redefined whole with 0533's body, one argument added and one column written.
--
-- ⚠ DEPLOY WINDOW: three added nullable columns no served code names, and a function whose old
-- 4-argument call still resolves (the fifth argument defaults to null and null writes nothing new).
-- Code served before S2 keeps working on either side of the merge (docs/MIGRATION-DISCIPLINE.md).

-- ── the two carrier settings ───────────────────────────────────────────────────────────────────
alter table public.recruiting_settings
  add column if not exists required_questions text[]
    check (required_questions is null
           or cardinality(required_questions) = 0
           or (cardinality(required_questions) <= 60
               and array_position(required_questions, null) is null
               and array_to_string(required_questions, ',') ~ '^[a-z0-9_]{1,60}(,[a-z0-9_]{1,60})*$')),
  add column if not exists offered_document_slots text[]
    check (offered_document_slots is null
           or cardinality(offered_document_slots) = 0
           or (cardinality(offered_document_slots) <= 60
               and array_position(offered_document_slots, null) is null
               and array_to_string(offered_document_slots, ',') ~ '^[a-z0-9_]{1,60}(,[a-z0-9_]{1,60})*$'));

comment on column public.recruiting_settings.required_questions is
  'HIRING-WORKFLOW-AUDIT §11 S1 (0550): the carrier''s questions an applicant must answer. Null = the served questionnaire''s own required flags (D-RS1); empty = none. Which ids MAY be required is decided by the API from the questionnaire definition (D-RS2); the reader ignores an id it does not have. Stamped onto each invitation at its first Send (application_invitations.required_questions).';

comment on column public.recruiting_settings.offered_document_slots is
  'HIRING-WORKFLOW-AUDIT §11 S1 (0550): the capture slots Part 2 "Your documents" offers. Null = every slot (D-RS6). The licence and the medical card are always offered — the reader''s rule, from the capture catalogue, not listed here.';

-- ── the set this applicant is asked for ────────────────────────────────────────────────────────
alter table public.application_invitations
  add column if not exists required_questions text[]
    check (required_questions is null
           or cardinality(required_questions) = 0
           or (cardinality(required_questions) <= 60
               and array_position(required_questions, null) is null
               and array_to_string(required_questions, ',') ~ '^[a-z0-9_]{1,60}(,[a-z0-9_]{1,60})*$'));

comment on column public.application_invitations.required_questions is
  'HIRING-WORKFLOW-AUDIT §11 S1 (0550): the carrier questions this applicant must answer, stamped once by send_application_invitation at the first Send (D-RS3) and never changed by a resend. Null = sent before 0550''s reader: the flags of the draft''s own questionnaire_version decide, as before.';

-- ── send_application_invitation: 0533's body, stamping the required set once ───────────────────
-- Dropped and recreated rather than overloaded: two functions answering the same named call would be
-- ambiguous to PostgREST. The fifth argument defaults, so the 4-argument call code served before S2
-- makes resolves to this function and stamps nothing (0230's widening pattern).
drop function if exists public.send_application_invitation(uuid, uuid, text, int);

create or replace function public.send_application_invitation(
  p_org                uuid,
  p_invitation         uuid,
  p_token_hash         text,
  p_extend_days        int,
  p_required_questions text[] default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found     boolean;
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_sent      timestamptz;
begin
  if nullif(p_token_hash, '') is null or p_extend_days is null or p_extend_days < 1 then
    raise exception 'send_application_invalid' using errcode = 'AI004';
  end if;

  select true, revoked_at, submitted_at
    into v_found, v_revoked, v_submitted
    from public.application_invitations
   where id = p_invitation and org_id = p_org
   for update;

  if v_found is null then
    raise exception 'application_invitation_not_found' using errcode = 'AI001';
  end if;
  if v_revoked is not null then
    raise exception 'application_invitation_unusable' using errcode = 'AI002';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'AI003';
  end if;

  -- ⚠ The stamp reads the row as it was BEFORE this update (SET expressions see the old row), so it is
  -- written on the first Send and left alone by every resend: the applicant keeps the rules they were
  -- first served (D-RS3).
  update public.application_invitations
     set token_hash          = p_token_hash,
         required_questions  = case when application_sent_at is null then p_required_questions
                                    else required_questions end,
         application_sent_at = coalesce(application_sent_at, now()),
         expires_at          = greatest(expires_at, now() + make_interval(days => p_extend_days))
   where id = p_invitation and org_id = p_org
   returning application_sent_at into v_sent;

  return v_sent;
end;
$$;

revoke all on function public.send_application_invitation(uuid, uuid, text, int, text[])
  from public, anon, authenticated;
grant execute on function public.send_application_invitation(uuid, uuid, text, int, text[]) to service_role;

comment on function public.send_application_invitation(uuid, uuid, text, int, text[]) is
  'AF2/D-AF5/D-AF7: the office sends the application form. Rotates the token in place (0232), stamps application_sent_at once, and extends expires_at without ever shortening it. Refuses AI001 not found, AI002 revoked, AI003 submitted, AI004 invalid. Since 0533 (HIRING-WORKFLOW-AUDIT §9 P3) the permissions coming first is advised, not refused. Since 0550 (§11 S1) it stores p_required_questions — the carrier questions this applicant must answer, resolved by the API — on the FIRST send only; a resend never restamps (D-RS3).';
