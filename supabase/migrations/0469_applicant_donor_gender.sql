-- 0469 — the drug-test donor's gender, asked in Part 1 (MEDSTOP-PLAN.md §7A.10 answer 3, D-MSUX3, D-MS1;
-- batch UX5a).
--
-- ── WHY IT IS ASKED AT ALL ──────────────────────────────────────────────────────────────────────
-- Med-Stop will not create a donor without it (`WizApplicant.gender`, required; `/List/GENDER` read
-- 2026-10-13: MALE, FEMALE — nothing else), and a return-to-duty or follow-up collection is OBSERVED by
-- a person of the donor's gender (§40.67(g)). Part 1 already holds every other fact Med-Stop's
-- applicant record needs — home address, CDL class (`application_intakes`, `drivers`), CDL number,
-- state and expiry (`application_intake_licences`), date of birth (0365) — so this is the one column
-- D-MS1's "Part 1 grows the fields the drug test needs" still lacks (§7A.13 has the inventory).
--
-- ── WHY ON THE INTAKE ROW, AND NOT ON `drivers` ─────────────────────────────────────────────────
-- ⚠ The person who decides a hire must never see an applicant's sex — the rule the questionnaire's
-- reserved `eeo` key already keeps (`questionnaireContract.ts`, APPLICATION-SYSTEM-PLAN.md §6). The
-- recruiter decides the hire. `drivers` is read by the office browser (`ApplicantRecordPage` selects
-- `*`), so a column there would reach that screen the moment it existed. `application_intakes` has NO
-- client policy — only the api reads it, and every reader names its columns — so this value reaches
-- exactly the readers that ask for it: Med-Stop's applicant create and its observed-collection order
-- (UX5b/UX5c), both server-side, neither shown to anyone.
--
-- ── WHY THREE ANSWERS, AND NULL ─────────────────────────────────────────────────────────────────
-- `male` / `female` are Med-Stop's two codes. `declined` is an answer too (D-MSUX10): an applicant may
-- choose not to say, and the office then adds them in Med-Stop by hand, as it does for every applicant
-- today — the question is never a gate on the application. NULL means never asked: every applicant
-- before UX5, and any who has not reached the screen.
--
-- ── WHY ITS OWN MERGE ───────────────────────────────────────────────────────────────────────────
-- A new column on a table code already reads, and a new key its writer accepts: the screen that asks
-- and the readers ship in the next merge (`lint:migration-ordering`, MIGRATION-DISCIPLINE.md
-- §the-deploy-window). The writer is redefined here with the SAME signature, and an absent key keeps
-- the stored value, so the code serving either side of this migration calls it exactly as before.
alter table public.application_intakes
  add column if not exists donor_gender text
    constraint application_intakes_donor_gender_check
    check (donor_gender is null or donor_gender in ('male', 'female', 'declined'));

comment on column public.application_intakes.donor_gender is
  'D-MSUX3/D-MSUX10 (0469): the drug-test donor''s gender for Med-Stop (required to create the donor; same-gender observer, §40.67(g)). male | female | declined; NULL = never asked. Never shown to the person deciding the hire — read server-side by the Med-Stop applicant create and observed orders only.';

-- ── record_applicant_intake, as 0376 wrote it, plus the one key ─────────────────────────────────
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
       fcra_summary_version, fcra_summary_shown_at, medical_card_pending, donor_gender)
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
       nullif(btrim(v_in ->> 'donor_gender'), ''))
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
      (org_id, invitation_id, position, state_code, agency, licence_number, expires_on, source)
    select p_org, p_invitation, (l ->> 'position')::smallint, upper(btrim(l ->> 'state_code')),
           nullif(btrim(l ->> 'agency'), ''), btrim(l ->> 'licence_number'),
           (l ->> 'expires_on')::date, coalesce(l ->> 'source', 'intake')
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

comment on function public.record_applicant_intake(uuid, uuid, uuid, jsonb, jsonb, text[], boolean) is
  'D-AW3: the one writer of Part 1. Writes the intake row (present keys only), replaces the licence list while Part 1 is open (the office may correct after), fills or overwrites the drivers row by 0365''s rule, records the declared endorsements, and routes DOB/licence through record_applicant_identity. Since 0469 also the donor_gender answer (intake row only, never drivers). Refuses AI001 not found, AI002 revoked (or expired, applicant only), AI003 submitted, AI004 malformed, AI008 Part 1 complete (applicant), AI009 §40.25(j) unanswered.';

