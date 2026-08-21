-- 0231 — the names a previous employer would know this driver by (APPLICATION-SYSTEM-PLAN A9
-- follow-up; 49 CFR §391.23(a)(2)).
--
-- ── WHAT THIS IS NOT ───────────────────────────────────────────────────────────────────────────
-- It is NOT a §391.21(b) application field, and the distinction was checked against the primary
-- sources rather than assumed. §391.21(b)(2) reads, in full: "The applicant's name, address, date of
-- birth, and social security number". FMCSA's own sample driver employment application
-- (csa.fmcsa.dot.gov, read 2026-08-21) asks for first, middle and last name and no other name
-- anywhere on its four pages. Secondary sources claiming the FMCSRs require aliases are simply wrong,
-- and this column does not pretend otherwise.
--
-- ── WHAT IT IS FOR ─────────────────────────────────────────────────────────────────────────────
-- §391.23(a)(2) obliges the carrier to investigate the driver's employment for the preceding three
-- years, and §391.23(c)(2) makes a written record of each previous employer contacted part of the
-- qualification file. A driver who drove for four years under a maiden name is a driver that former
-- employer's records do not contain: the inquiry goes out addressed to somebody they have never heard
-- of, comes back "no record", and a clean safety history reads as an absent one.
--
-- The owner's packet agrees about where this belongs. Aliases appear nowhere on its application
-- pages; they appear once, on the "10 YEAR EMPLOYMENT HISTORY BACKGROUND VERIFICATION LOG" — the
-- office worksheet that `employer_inquiries` (0223) replaced.
--
-- ── WHY A COLUMN ON `drivers` AND NOT A FIELD LEFT IN THE PAYLOAD ──────────────────────────────
-- Because the entire value of the fact is that it reaches the letter. `composeInquiry` fills
-- `{{driver}}` from `drivers.full_name`; a maiden name that stayed in `driver_applications.payload`
-- would be something we asked for, stored, and never used — which is the same write-only failure that
-- made A9 render its questionnaire rather than merely collect it.
--
-- `text[]` rather than a child table: it is a short list of strings belonging to exactly one row, read
-- whole every time and never joined, filtered or counted. A table would buy nothing and cost a join
-- on the one path that matters.
alter table public.drivers
  add column if not exists other_names text[];

comment on column public.drivers.other_names is
  'Other names this driver has been known by — maiden names, former legal names. NOT a §391.21(b) field (b)(2) does not list one and FMCSA''s own sample application does not ask): it exists for §391.23(a)(2), because a previous employer cannot verify a driver whose name their records do not contain. Populated from the application and used to compose the inquiry.';

-- ── THE INTAKE LEARNS ONE MORE COLUMN ──────────────────────────────────────────────────────────
-- ⚠ Same signature as 0230's, so this is a genuine `create or replace` and not a second overload —
-- the twelve parameters are unchanged and only the body differs. `p_driver_patch` is jsonb precisely
-- so that adding a projected field costs a line here and nothing at the call site.
--
-- `coalesce` on the TARGET side, like every other line in this UPDATE: a recruiter who already
-- recorded a driver's former name keeps it, and an application never silently overwrites a value
-- somebody checked against a document. An empty list stays NULL rather than becoming `{}` — "we never
-- asked" and "they said none" are different facts, and `array_agg` over no rows returns NULL, which
-- is the one place that distinction is free.
create or replace function public.submit_driver_application(
  p_org           uuid,
  p_invitation    uuid,
  p_driver        uuid,
  p_payload       jsonb,
  p_signed_name   text,
  p_ip            text,
  p_user_agent    text,
  p_ssn_last4     text,
  p_ssn_sealed    text,
  p_driver_patch  jsonb,
  p_employment    jsonb,
  p_captures      jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submitted timestamptz;
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_app       uuid;
begin
  -- FOR UPDATE: a phase is only spent once if the check and the stamp are the same transaction.
  select submitted_at, expires_at, revoked_at
    into v_submitted, v_expires, v_revoked
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'DA020';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'DA021';
  end if;
  if v_submitted is not null then
    raise exception 'application_already_submitted' using errcode = 'DA022';
  end if;

  insert into public.driver_applications
    (org_id, driver_id, invitation_id, payload, signed_name, applicant_ip, applicant_user_agent,
     ssn_last4, ssn_sealed)
  values
    (p_org, p_driver, p_invitation, p_payload, p_signed_name, p_ip, p_user_agent,
     p_ssn_last4, p_ssn_sealed)
  returning id into v_app;

  update public.application_invitations
     set submitted_at = now()
   where id = p_invitation and org_id = p_org;

  update public.drivers d
     set first_name    = coalesce(d.first_name, p_driver_patch ->> 'first_name'),
         last_name     = coalesce(d.last_name, p_driver_patch ->> 'last_name'),
         date_of_birth = coalesce(d.date_of_birth, (p_driver_patch ->> 'date_of_birth')::date),
         cdl_number    = coalesce(d.cdl_number, p_driver_patch ->> 'cdl_number'),
         cdl_state     = coalesce(d.cdl_state, p_driver_patch ->> 'cdl_state'),
         -- §391.23(a)(2). See this migration's header for why it is projected at all.
         other_names   = coalesce(
                           d.other_names,
                           (select array_agg(n)
                              from jsonb_array_elements_text(
                                     coalesce(p_driver_patch -> 'other_names', '[]'::jsonb)) as t(n))),
         updated_at    = now()
   where d.id = p_driver and d.org_id = p_org;

  insert into public.driver_employment_history
    (org_id, driver_id, employer_name, usdot_number, employer_address_line1, employer_city,
     employer_state, employer_phone, employer_email,
     position_held, started_on, ended_on, dot_regulated, operated_cmv,
     subject_to_fmcsr, safety_sensitive, reason_for_leaving, inquiry_status, source)
  select p_org, p_driver, e.employer_name, e.usdot_number, e.employer_address_line1, e.employer_city,
         e.employer_state, e.employer_phone, e.employer_email,
         e.position_held, e.started_on, e.ended_on,
         e.dot_regulated, e.operated_cmv, e.subject_to_fmcsr, e.safety_sensitive, e.reason_for_leaving,
         case when e.dot_regulated then 'pending' else 'not_required' end,
         'application'
    from jsonb_to_recordset(coalesce(p_employment, '[]'::jsonb)) as e(
           employer_name text, usdot_number text, employer_address_line1 text,
           employer_city text, employer_state text,
           employer_phone text, employer_email text, position_held text,
           started_on date, ended_on date, dot_regulated boolean, operated_cmv boolean,
           subject_to_fmcsr boolean, safety_sensitive boolean, reason_for_leaving text
         );

  -- A8/D-APP10. The staged photographs become filed documents inside this transaction; the caller has
  -- already copied the objects, and the JOIN is what stops the array filing anything that is not a
  -- real staged capture of this invitation.
  insert into public.documents
    (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, page,
     captured_at, uploaded_by)
  select ac.id, p_org, 'driver', p_driver, c.kind, c.storage_path, ac.content_type, ac.bytes,
         ac.sha256, c.page, ac.captured_at, null::uuid
    from jsonb_to_recordset(coalesce(p_captures, '[]'::jsonb)) as c(
           capture_id uuid, kind text, page int, storage_path text)
    join public.application_captures ac
      on ac.id = c.capture_id and ac.invitation_id = p_invitation and ac.org_id = p_org;

  insert into public.qualification_records
    (org_id, driver_id, kind, occurred_on, result, reference, detail)
  values
    (p_org, p_driver, 'employment_application', current_date, 'certified', v_app::text,
     jsonb_build_object('source', 'application_intake', 'application_id', v_app));

  return jsonb_build_object('application_id', v_app);
end;
$$;

revoke all on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb)
  to service_role;
