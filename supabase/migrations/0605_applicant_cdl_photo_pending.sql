-- 0605 — "I don't have my CDL with me": Part 1 can finish without the two CDL photographs
-- (APPLICATION-FIX-PLAN.md U8; SCREEN-MAP 1.2; owner's Q-AM5 ruling of 2026-11-11: "CDL photo skippable
-- to 'pending'").
--
-- ── WHAT THE GAP IS ───────────────────────────────────────────────────────────────────────────────
-- `complete_applicant_intake` (0376) refuses to end Part 1 (AI007) unless both sides of the CDL are
-- photographed. A driver who opens the link without the card in their pocket — at work, in a truck
-- that is not theirs — cannot go on at all, and the office never hears from them. The medical card
-- already has the answer this needs: `medical_card_pending` (D-AW4), "I don't have one yet", which lets
-- Part 1 finish and tells the office what is still owed.
--
-- ── THE SHAPE ─────────────────────────────────────────────────────────────────────────────────────
--   application_intakes.cdl_photo_pending   boolean not null default false
-- True = the driver said they do not have the card with them. The office reads it as "CDL photo
-- pending"; the photographs are then taken on the documents screen, or in the office. It is a state of
-- documents, never an answer on the application: the paper asks no such question.
--
-- ⚠ It stands in for BOTH sides or neither. One side photographed and the other missing is still AI007.
-- ⚠ The licence itself is still required: the number, state and expiration are typed (the barcode
--   cannot fill them), and `record_applicant_identity` and PSP read them exactly as before.
--
-- ── WHY ITS OWN MERGE ─────────────────────────────────────────────────────────────────────────────
-- A new column on a table code already reads: the screen that offers the answer and the readers ship in
-- the next merge (`lint:migration-ordering`, MIGRATION-DISCIPLINE.md §the-deploy-window). Both functions
-- are redefined with the SAME signatures. Code on either side of this migration calls them exactly as
-- before: nothing sends the key yet, an absent key writes false, and false is 0376's behaviour.
--
-- cross-module-waiver: none — recruiting's table and recruiting's functions.

alter table public.application_intakes
  add column if not exists cdl_photo_pending boolean not null default false;

comment on column public.application_intakes.cdl_photo_pending is
  'U8 (0605): the applicant said they do not have their CDL with them, so Part 1 finished without its two photographs. The office reads it as "CDL photo pending". A state of documents, not an application answer. False = 0376''s rule: both sides required.';

-- ── record_applicant_intake, as 0588 wrote it, plus the one key ─────────────────────────────────
create or replace function public.record_applicant_intake(
  p_org          uuid,
  p_invitation   uuid,
  p_driver       uuid,
  p_intake       jsonb,
  p_licences     jsonb,
  p_endorsements text[],
  p_overwrite    boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in        jsonb := coalesce(p_intake, '{}'::jsonb);
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_completed timestamptz;
  v_intake    uuid;
  v_prior     boolean;
  v_count     int;
  v_cdl       record;
  v_dob       date;
  v_identity  jsonb;
  v_before    record;
  v_after     record;
begin
  if p_overwrite is null or jsonb_typeof(v_in) <> 'object'
     or (p_licences is not null and jsonb_typeof(p_licences) <> 'array') then
    raise exception 'applicant_intake_invalid' using errcode = 'AI004';
  end if;

  select expires_at, revoked_at, submitted_at, intake_completed_at
    into v_expires, v_revoked, v_submitted, v_completed
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
  if v_completed is not null and not p_overwrite then
    raise exception 'intake_frozen' using errcode = 'AI008';
  end if;

  -- ── The intake row: UPDATE first, INSERT only if absent (lint:upserts, 0174) ──────────────────
  update public.application_intakes
     set phone                 = case when v_in ? 'phone' then nullif(btrim(v_in ->> 'phone'), '') else phone end,
         address_line1         = case when v_in ? 'address_line1' then nullif(btrim(v_in ->> 'address_line1'), '') else address_line1 end,
         address_line2         = case when v_in ? 'address_line2' then nullif(btrim(v_in ->> 'address_line2'), '') else address_line2 end,
         city                  = case when v_in ? 'city' then nullif(btrim(v_in ->> 'city'), '') else city end,
         state                 = case when v_in ? 'state' then nullif(btrim(v_in ->> 'state'), '') else state end,
         postal_code           = case when v_in ? 'postal_code' then nullif(btrim(v_in ->> 'postal_code'), '') else postal_code end,
         prior_positive_2y     = case when v_in ? 'prior_positive_2y' then (v_in ->> 'prior_positive_2y')::boolean else prior_positive_2y end,
         dot_program_30d       = case when v_in ? 'dot_program_30d' then (v_in ->> 'dot_program_30d')::boolean else dot_program_30d end,
         dot_tested_6m         = case when v_in ? 'dot_tested_6m' then (v_in ->> 'dot_tested_6m')::boolean else dot_tested_6m end,
         dot_random_12m        = case when v_in ? 'dot_random_12m' then (v_in ->> 'dot_random_12m')::boolean else dot_random_12m end,
         -- The version and the instant move together, and the instant is the server's.
         fcra_summary_version  = case when v_in ? 'fcra_summary_version' then v_in ->> 'fcra_summary_version' else fcra_summary_version end,
         fcra_summary_shown_at = case when v_in ? 'fcra_summary_version' then now() else fcra_summary_shown_at end,
         medical_card_pending  = case when v_in ? 'medical_card_pending' then coalesce((v_in ->> 'medical_card_pending')::boolean, false) else medical_card_pending end,
         cdl_photo_pending     = case when v_in ? 'cdl_photo_pending' then coalesce((v_in ->> 'cdl_photo_pending')::boolean, false) else cdl_photo_pending end,
         -- 0469: present key written, absent kept, like every key above. The check constraint
         -- refuses anything but the three answers (23514 — the caller's contract parses first).
         donor_gender          = case when v_in ? 'donor_gender' then nullif(btrim(v_in ->> 'donor_gender'), '') else donor_gender end,
         updated_at            = now()
   where invitation_id = p_invitation and org_id = p_org
   returning id, prior_positive_2y into v_intake, v_prior;

  if v_intake is null then
    insert into public.application_intakes
      (org_id, invitation_id, phone, address_line1, address_line2, city, state, postal_code,
       prior_positive_2y, dot_program_30d, dot_tested_6m, dot_random_12m,
       fcra_summary_version, fcra_summary_shown_at, medical_card_pending, donor_gender, cdl_photo_pending)
    values
      (p_org, p_invitation,
       nullif(btrim(v_in ->> 'phone'), ''), nullif(btrim(v_in ->> 'address_line1'), ''),
       nullif(btrim(v_in ->> 'address_line2'), ''), nullif(btrim(v_in ->> 'city'), ''),
       nullif(btrim(v_in ->> 'state'), ''), nullif(btrim(v_in ->> 'postal_code'), ''),
       (v_in ->> 'prior_positive_2y')::boolean, (v_in ->> 'dot_program_30d')::boolean,
       (v_in ->> 'dot_tested_6m')::boolean, (v_in ->> 'dot_random_12m')::boolean,
       v_in ->> 'fcra_summary_version',
       case when v_in ? 'fcra_summary_version' then now() end,
       coalesce((v_in ->> 'medical_card_pending')::boolean, false),
       nullif(btrim(v_in ->> 'donor_gender'), ''),
            coalesce((v_in ->> 'cdl_photo_pending')::boolean, false))
    on conflict (invitation_id) do nothing
    returning id, prior_positive_2y into v_intake, v_prior;
    if v_intake is null then
      -- Lost the insert race to a concurrent first save under a different lock path: the row exists
      -- now, and the invitation lock above makes this unreachable in practice. Refuse rather than
      -- silently drop what was sent.
      raise exception 'applicant_intake_concurrent_write' using errcode = 'AI004';
    end if;
  end if;

  if v_prior is null then
    raise exception 'prior_positive_required' using errcode = 'AI009';
  end if;

  -- ── Licences: replaced whole when sent ─────────────────────────────────────────────────────────
  if p_licences is not null then
    if exists (select 1 from jsonb_array_elements(p_licences) l
                where jsonb_typeof(l) <> 'object'
                   or nullif(l ->> 'position', '') is null
                   or nullif(btrim(l ->> 'state_code'), '') is null
                   or nullif(btrim(l ->> 'licence_number'), '') is null) then
      raise exception 'applicant_intake_licence_incomplete' using errcode = 'AI004';
    end if;
    delete from public.application_intake_licences
     where invitation_id = p_invitation and org_id = p_org;
    insert into public.application_intake_licences
      (org_id, invitation_id, position, state_code, agency, licence_number, expires_on, source, kind)
    select p_org, p_invitation, (l ->> 'position')::smallint, upper(btrim(l ->> 'state_code')),
           nullif(btrim(l ->> 'agency'), ''), btrim(l ->> 'licence_number'),
           (l ->> 'expires_on')::date, coalesce(l ->> 'source', 'intake'),
           -- 0588: the licence's TYPE. Absent or blank is NULL (never asked); the column's CHECK
           -- refuses anything but the four answers (23514; the caller's contract parses first).
           nullif(btrim(l ->> 'kind'), '')
      from jsonb_array_elements(p_licences) l;
  end if;

  select count(*) into v_count
    from public.application_intake_licences
   where invitation_id = p_invitation and org_id = p_org;
  select state_code, licence_number, expires_on into v_cdl
    from public.application_intake_licences
   where invitation_id = p_invitation and org_id = p_org and position = 0;

  -- ── The drivers row: contact and CDL class/expiry, 0365's rule ─────────────────────────────────
  select phone, address_line1, address_line2, city, state, postal_code, cdl_class, cdl_expires_at, date_of_birth
    into v_before
    from public.drivers
   where id = p_driver and org_id = p_org
   for update;

  update public.drivers d
     set phone          = case when p_overwrite and v_in ? 'phone' then i.phone else coalesce(d.phone, i.phone) end,
         address_line1  = case when p_overwrite and v_in ? 'address_line1' then i.address_line1 else coalesce(d.address_line1, i.address_line1) end,
         address_line2  = case when p_overwrite and v_in ? 'address_line2' then i.address_line2 else coalesce(d.address_line2, i.address_line2) end,
         city           = case when p_overwrite and v_in ? 'city' then i.city else coalesce(d.city, i.city) end,
         state          = case when p_overwrite and v_in ? 'state' then i.state else coalesce(d.state, i.state) end,
         postal_code    = case when p_overwrite and v_in ? 'postal_code' then i.postal_code else coalesce(d.postal_code, i.postal_code) end,
         cdl_class      = case when p_overwrite and v_in ? 'cdl_class' then nullif(v_in ->> 'cdl_class', '')
                               else coalesce(d.cdl_class, nullif(v_in ->> 'cdl_class', '')) end,
         cdl_expires_at = case when p_overwrite and p_licences is not null then v_cdl.expires_on
                               else coalesce(d.cdl_expires_at, v_cdl.expires_on) end,
         updated_at     = now()
    from public.application_intakes i
   where d.id = p_driver and d.org_id = p_org
     and i.invitation_id = p_invitation and i.org_id = p_org
   returning d.phone, d.address_line1, d.address_line2, d.city, d.state, d.postal_code, d.cdl_class, d.cdl_expires_at
     into v_after;

  -- Endorsements: the declared list, replaced whole when sent, on the intake row only (see the
  -- column's comment for why nothing is projected onto the roster).
  if p_endorsements is not null then
    update public.application_intakes
       set endorsements = (select coalesce(array_agg(distinct upper(btrim(c)) order by upper(btrim(c))), '{}'::text[])
                             from unnest(p_endorsements) as t(c)
                            where nullif(btrim(c), '') is not null)
     where id = v_intake;
  end if;

  -- ── Identity through its one writer (0365) ─────────────────────────────────────────────────────
  -- Only once there is both a DOB and a current licence to write; Part 1 posts the licences on their
  -- own screen, so an earlier call legitimately has neither yet.
  v_dob := coalesce((v_in ->> 'date_of_birth')::date, v_before.date_of_birth);
  if v_dob is not null and v_cdl.licence_number is not null then
    v_identity := public.record_applicant_identity(
      p_org, p_invitation, p_driver, v_dob, v_cdl.licence_number, v_cdl.state_code, p_overwrite);
  end if;

  return jsonb_build_object(
    'intake_id', v_intake,
    'licence_count', v_count,
    'identity', v_identity,
    -- Names only, never values: 0365's rule for what goes back to a caller on a bare link.
    'kept_existing', to_jsonb(array_remove(array[
      case when not p_overwrite and v_in ? 'phone' and v_after.phone is distinct from nullif(btrim(v_in ->> 'phone'), '') then 'phone' end,
      case when not p_overwrite and v_in ? 'address_line1' and v_after.address_line1 is distinct from nullif(btrim(v_in ->> 'address_line1'), '') then 'address_line1' end,
      case when not p_overwrite and v_in ? 'city' and v_after.city is distinct from nullif(btrim(v_in ->> 'city'), '') then 'city' end,
      case when not p_overwrite and v_in ? 'state' and v_after.state is distinct from nullif(btrim(v_in ->> 'state'), '') then 'state' end,
      case when not p_overwrite and v_in ? 'postal_code' and v_after.postal_code is distinct from nullif(btrim(v_in ->> 'postal_code'), '') then 'postal_code' end
    ], null))
  );
end;
$$;

revoke all on function public.record_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], boolean)
  from public, anon, authenticated;
grant execute on function public.record_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], boolean)
  to service_role;

-- ── complete_applicant_intake, as 0376 wrote it, with the CDL's two photographs waivable ────────
create or replace function public.complete_applicant_intake(
  p_org        uuid,
  p_invitation uuid,
  p_driver     uuid,
  p_captures   jsonb
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_submitted timestamptz;
  v_completed timestamptz;
  v_shown     timestamptz;
  v_pending   boolean;
  v_cdl_later boolean;
begin
  select expires_at, revoked_at, submitted_at, intake_completed_at
    into v_expires, v_revoked, v_submitted, v_completed
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'AI001';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'AI002';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'AI003';
  end if;
  if v_completed is not null then
    return v_completed;
  end if;

  select fcra_summary_shown_at, medical_card_pending, cdl_photo_pending into v_shown, v_pending, v_cdl_later
    from public.application_intakes
   where invitation_id = p_invitation and org_id = p_org;

  -- 0605: "I don't have my CDL with me" stands in for BOTH sides, as "I don't have a medical card yet"
  -- stands in for that photograph. One side photographed and the other not is still refused: a card
  -- the driver has in hand has two sides.
  if v_shown is null
     or (not coalesce(v_cdl_later, false)
         and (not exists (select 1 from public.application_captures
                           where invitation_id = p_invitation and org_id = p_org and slot = 'cdl_front')
              or not exists (select 1 from public.application_captures
                              where invitation_id = p_invitation and org_id = p_org and slot = 'cdl_back')))
     or (not coalesce(v_pending, false)
         and not exists (select 1 from public.application_captures
                          where invitation_id = p_invitation and org_id = p_org and slot = 'medical_card')) then
    raise exception 'intake_incomplete' using errcode = 'AI007';
  end if;

  with promoted as (
    insert into public.documents
      (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, page,
       captured_at, uploaded_by)
    select ac.id, p_org, 'driver', p_driver, c.kind, c.storage_path, ac.content_type, ac.bytes,
           ac.sha256, c.page, ac.captured_at, null::uuid
      from jsonb_to_recordset(coalesce(p_captures, '[]'::jsonb)) as c(
             capture_id uuid, kind text, page int, storage_path text)
      join public.application_captures ac
        on ac.id = c.capture_id and ac.invitation_id = p_invitation and ac.org_id = p_org
     where ac.slot <> 'selfie'
       and ac.promoted_document_id is null
    returning id
  )
  update public.application_captures
     set promoted_document_id = promoted.id
    from promoted
   where application_captures.id = promoted.id;

  update public.application_invitations
     set intake_completed_at = coalesce(intake_completed_at, now())
   where id = p_invitation and org_id = p_org
   returning intake_completed_at into v_completed;

  return v_completed;
end;
$$;

revoke all on function public.complete_applicant_intake(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_applicant_intake(uuid, uuid, uuid, jsonb) to service_role;

comment on function public.complete_applicant_intake(uuid, uuid, uuid, jsonb) is
  'D-AW1/D-AW4: finish Part 1. Refuses AI001/AI002/AI003, and AI007 unless the FCRA summary was shown, the CDL''s front and back are captured or declared not at hand (cdl_photo_pending, 0605), and the medical card is captured or declared pending. Files the staged captures it is handed (never the selfie), exactly once. Idempotent.';
