-- 0365 — two phases and two functions for the owner's order of the hire (APPLICANT-FLOW-PLAN AF2).
--
-- ── WHAT CHANGED ABOUT THE ORDER ───────────────────────────────────────────────────────────────
-- Until 2026-09-24 one link ran the whole walk: consent → the permissions → the form, all in one
-- sitting (`ApplyPage.vue`'s `v-else-if` chain; nothing on the server stopped the form opening the
-- moment the last release was signed). The owner restated the carrier's real order: permissions and
-- identity FIRST, then the office screens (PSP, MVR, Clearinghouse, drug test), and only THEN does the
-- office send the application. Approval then no longer opens the packet; the office opens signing in
-- person (D-AF1..3). Two acts the office performs therefore need a date on the invitation:
--
--   application_sent_at   the office sent the application link (AF4 gates the form on it)
--   signing_opened_at     the office opened packet signing, in the office (AF5 gates the marks on it)
--
-- ⚠ No TypeScript reads either column in this migration's merge (lint:migration-ordering): a merge is
-- SERVED ~2m44s before its migration is APPLIED (docs/MIGRATION-DISCIPLINE.md §the-deploy-window).
-- AF3/AF4/AF5 are the readers, each in its own later merge.
alter table public.application_invitations
  add column if not exists application_sent_at timestamptz,
  add column if not exists signing_opened_at   timestamptz;

comment on column public.application_invitations.application_sent_at is
  'AF2/D-AF5: when the office first sent this applicant the application form, after their permissions. Stamped once (a second send rotates the link and keeps this date). Backfilled from releases_completed_at for invitations that were already past the permissions on 2026-09-24, because under the old order the form opened at that moment.';
comment on column public.application_invitations.signing_opened_at is
  'AF2/D-AF3/D-AF6: when the office opened packet signing, in person. Stamped once. Not backfilled: filed packets never sign again, and an approved unfiled walk is re-opened by the office under the new rule.';

-- ── THE BACKFILL: NOBODY LOSES A FORM THEY ALREADY HAVE ────────────────────────────────────────
-- Under the old order the form opened the instant `releases_completed_at` was stamped, so for every
-- invitation already past the permissions that IS the date the application was "sent". AF4 will
-- refuse the form without `application_sent_at`; without this line it would lock two production
-- applicants (APPLICANT-FLOW-PLAN §2.13, rows 3 and 4) out of forms they have filled or filed.
-- Nothing else moves, and `signing_opened_at` is deliberately left null (see its comment).
update public.application_invitations
   set application_sent_at = releases_completed_at
 where releases_completed_at is not null
   and application_sent_at is null;

-- ── IDENTITY: ONE WRITER FOR THE DRIVER ROW AND THE DRAFT TOGETHER (D-AF1, D-AF8) ───────────────
-- PSP reads `drivers.date_of_birth, cdl_number, cdl_state` (pspOrder.ts), the form reads the draft,
-- and the filed application projects the draft onto `drivers` fill-only-null (0231). D-AF1 moves the
-- collection of those three facts to the permissions step, before PSP. Two writers — one for the row
-- and one for the draft — would let the licence PSP was run against differ from the licence on the
-- filed application, which is the one disagreement a §391.23 file cannot have.
--
-- So one function writes both, in one transaction, and the DRAFT RECEIVES WHAT ENDED UP ON THE ROW:
--   · p_overwrite = false (the applicant): `coalesce(existing, new)` per column, 0231's semantics.
--     A value already on `drivers` — the office's correction, a rehire's record — wins, and the draft
--     is given THAT value rather than what was typed, so the two cannot disagree.
--   · p_overwrite = true (the office's correction): the new values are set on both.
--
-- ⚠ Not `.upsert()` with a partial payload (lint:upserts, 0174's incident): the draft is UPDATE-first
-- and INSERT-only-if-absent with the unique_violation retry, 0226's `save_application_draft` pattern.
-- The merge is `payload || {…}`, so every other key the applicant has typed is kept.
--
-- ⚠ Refusals, in the new AI0xx range (unused anywhere in the migrations on 2026-09-24):
--   AI001  no such invitation for this org and driver
--   AI002  revoked; or expired, on the APPLICANT's path only (see below)
--   AI003  already submitted — the filed application is frozen, and so is what it says
--   AI004  a value is missing
--
-- ⚠ Expiry refuses the applicant and NOT the office, and that is a deliberate reading of the plan.
-- The owner's order waits on drug-test results and travel and so outlives the 14-day link (§2.8). An
-- office that must correct a DOB before ordering PSP for somebody whose link lapsed during screening
-- would otherwise be pushed to PATCH `drivers` directly — the second writer this function exists to
-- remove. The applicant's own path is refused on expiry here AND by the token resolution before it.
create or replace function public.record_applicant_identity(
  p_org         uuid,
  p_invitation  uuid,
  p_driver      uuid,
  p_dob         date,
  p_cdl_number  text,
  p_cdl_state   text,
  p_overwrite   boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_dob       date;
  v_number    text;
  v_state     text;
  v_patch     jsonb;
  v_draft     uuid;
begin
  if p_dob is null or nullif(btrim(p_cdl_number), '') is null or nullif(btrim(p_cdl_state), '') is null then
    raise exception 'applicant_identity_incomplete' using errcode = 'AI004';
  end if;

  -- FOR UPDATE: the submission (0231) projects the draft onto `drivers` in its own transaction, and a
  -- correction interleaving with it could land on the row after the projection read the draft.
  select expires_at, revoked_at, submitted_at
    into v_expires, v_revoked, v_submitted
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'AI001';
  end if;
  if v_revoked is not null or (not p_overwrite and v_expires <= now()) then
    raise exception 'application_invitation_unusable' using errcode = 'AI002';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'AI003';
  end if;

  update public.drivers d
     set date_of_birth = case when p_overwrite then p_dob else coalesce(d.date_of_birth, p_dob) end,
         cdl_number    = case when p_overwrite then btrim(p_cdl_number)
                              else coalesce(d.cdl_number, btrim(p_cdl_number)) end,
         cdl_state     = case when p_overwrite then btrim(p_cdl_state)
                              else coalesce(d.cdl_state, btrim(p_cdl_state)) end
   where d.id = p_driver and d.org_id = p_org
   returning d.date_of_birth, d.cdl_number, d.cdl_state into v_dob, v_number, v_state;

  if v_dob is null then
    -- The invitation names a driver this org does not hold: unreachable through the FK, but a
    -- function that silently wrote the draft and not the row would be the two-writer bug in reverse.
    raise exception 'application_invitation_not_found' using errcode = 'AI001';
  end if;

  -- The draft's keys are `driverApplicationSchema`'s own (`applicationContract.ts`), and the date is
  -- written as the YYYY-MM-DD string that schema validates, not as a jsonb date.
  v_patch := jsonb_build_object(
    'date_of_birth', to_char(v_dob, 'YYYY-MM-DD'),
    'cdl_number',    v_number,
    'cdl_state',     v_state
  );

  update public.application_drafts
     set payload    = payload || v_patch,
         updated_at = now()
   where invitation_id = p_invitation and org_id = p_org
   returning id into v_draft;

  if v_draft is null then
    begin
      insert into public.application_drafts (org_id, invitation_id, driver_id, payload)
      values (p_org, p_invitation, p_driver, v_patch)
      returning id into v_draft;
    exception when unique_violation then
      update public.application_drafts
         set payload    = payload || v_patch,
             updated_at = now()
       where invitation_id = p_invitation and org_id = p_org
       returning id into v_draft;
    end;
  end if;

  return jsonb_build_object(
    'draft_id', v_draft,
    -- Which columns kept a value already on file instead of the one supplied. Names only, never the
    -- values: D-APP16 keeps the DOB off the bare link, and the caller has no need to be told it back.
    'kept_existing', to_jsonb(array_remove(array[
      case when not p_overwrite and v_dob <> p_dob then 'date_of_birth' end,
      case when not p_overwrite and v_number <> btrim(p_cdl_number) then 'cdl_number' end,
      case when not p_overwrite and v_state <> btrim(p_cdl_state) then 'cdl_state' end
    ], null))
  );
end;
$$;

revoke all on function public.record_applicant_identity(uuid, uuid, uuid, date, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.record_applicant_identity(uuid, uuid, uuid, date, text, text, boolean)
  to service_role;

comment on function public.record_applicant_identity(uuid, uuid, uuid, date, text, text, boolean) is
  'AF2/D-AF8: the one writer of an applicant''s DOB, licence number and licence state. Sets the drivers row (fill-only-null for the applicant, overwrite for the office) and merges the RESULTING values into the draft in the same transaction, so the licence PSP ran against is the licence on the filed application. Refuses AI001 not found, AI002 revoked (or expired, applicant only), AI003 submitted, AI004 incomplete.';

-- ── SENDING THE APPLICATION (D-AF5, D-AF7) ─────────────────────────────────────────────────────
-- The office's act between screening and the form. Rotates the token IN PLACE — 0232's reasoning,
-- unchanged: the plaintext was returned once at mint and never kept, the draft is keyed on the
-- invitation, so a new invitation would open an empty form. Same row, fresh hash.
--
--   · `application_sent_at = coalesce(application_sent_at, now())` — a second press (a lost email)
--     rotates and re-sends, and the stamp keeps its FIRST date, which is the one the checklist shows.
--   · `expires_at = greatest(…)` never SHORTENS a link (0232's rule).
--
-- ⚠ Refuses `releases_not_complete` (AI005): the form comes after the permissions or not at all. It
-- WARNS on outstanding screening and never refuses on it — that is D-AF5, and it is the API's job,
-- because nothing in law puts screening before the application.
-- ⚠ It revives an EXPIRED link rather than refusing it. §3.2 of the plan refuses only the revoked,
-- and the order it serves is exactly the one that outlives 14 days: the permissions are signed, the
-- office waits a fortnight for a lab, the link lapses, and "send the application" is the act that
-- should bring it back. Revoked (AI002) and submitted (AI003) are still refused.
create or replace function public.send_application_invitation(
  p_org         uuid,
  p_invitation  uuid,
  p_token_hash  text,
  p_extend_days int
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
  v_released  timestamptz;
  v_sent      timestamptz;
begin
  if nullif(p_token_hash, '') is null or p_extend_days is null or p_extend_days < 1 then
    raise exception 'send_application_invalid' using errcode = 'AI004';
  end if;

  select true, revoked_at, submitted_at, releases_completed_at
    into v_found, v_revoked, v_submitted, v_released
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
  if v_released is null then
    raise exception 'releases_not_complete' using errcode = 'AI005';
  end if;

  update public.application_invitations
     set token_hash          = p_token_hash,
         application_sent_at = coalesce(application_sent_at, now()),
         expires_at          = greatest(expires_at, now() + make_interval(days => p_extend_days))
   where id = p_invitation and org_id = p_org
   returning application_sent_at into v_sent;

  return v_sent;
end;
$$;

revoke all on function public.send_application_invitation(uuid, uuid, text, int)
  from public, anon, authenticated;
grant execute on function public.send_application_invitation(uuid, uuid, text, int) to service_role;

comment on function public.send_application_invitation(uuid, uuid, text, int) is
  'AF2/D-AF5/D-AF7: the office sends the application form after the permissions. Rotates the token in place (0232), stamps application_sent_at once, and extends expires_at without ever shortening it — reviving a link that lapsed while the office screened. Refuses AI001 not found, AI002 revoked, AI003 submitted, AI004 invalid, AI005 permissions not complete.';
