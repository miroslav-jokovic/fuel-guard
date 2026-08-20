-- 0222 — the address §391.23(c)(2) requires, and the email an inquiry is sent to (EMPLOYER-INQUIRY-PLAN E1).
--
-- §391.23(c)(2) requires a written record for each previous employer contacted containing "the
-- previous employer's name and ADDRESS, the date the previous employer was contacted, or the
-- attempts made, and the information received". `driver_employment_history` has carried a city and a
-- state since 0208 and no address line, so the record the regulation asks for could not be made.
--
-- The applicant has been typing one the whole time. `applicationEmployerSchema` collects
-- `address_line1` for every declared employer, and 0220's projection dropped it on the floor — the
-- form asked a question and the database threw the answer away. This adds the column and carries
-- both the address and the employer's email through the same projection.
--
-- `create or replace` in a NEW file is how a function changes here (0089/0096/0154/0203). The body
-- below is 0220's, with two lines added to the insert and two to the recordset definition; nothing
-- else about the application transaction is touched.

alter table public.driver_employment_history
  add column if not exists employer_address_line1 text;

comment on column public.driver_employment_history.employer_address_line1 is
  'Street address of the previous employer. Required by §391.23(c)(2) in the written record of each inquiry; collected on the application and carried through by submit_driver_application.';

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
  p_employment    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_used   timestamptz;
  v_expires timestamptz;
  v_revoked timestamptz;
  v_app    uuid;
begin
  -- FOR UPDATE: single-use is only single-use if the check and the stamp are the same transaction.
  select used_at, expires_at, revoked_at
    into v_used, v_expires, v_revoked
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'DA020';
  end if;
  if v_used is not null or v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_spent' using errcode = 'DA021';
  end if;

  insert into public.driver_applications
    (org_id, driver_id, invitation_id, payload, signed_name, applicant_ip, applicant_user_agent,
     ssn_last4, ssn_sealed)
  values
    (p_org, p_driver, p_invitation, p_payload, p_signed_name, p_ip, p_user_agent,
     p_ssn_last4, p_ssn_sealed)
  returning id into v_app;

  update public.application_invitations
     set used_at = now()
   where id = p_invitation and org_id = p_org;

  -- Identity from what the applicant declared. `coalesce` on the TARGET side: a recruiter who
  -- already typed a licence number keeps it, and the application never silently overwrites a value
  -- somebody checked against a document.
  update public.drivers d
     set first_name    = coalesce(d.first_name, p_driver_patch ->> 'first_name'),
         last_name     = coalesce(d.last_name, p_driver_patch ->> 'last_name'),
         date_of_birth = coalesce(d.date_of_birth, (p_driver_patch ->> 'date_of_birth')::date),
         cdl_number    = coalesce(d.cdl_number, p_driver_patch ->> 'cdl_number'),
         cdl_state     = coalesce(d.cdl_state, p_driver_patch ->> 'cdl_state'),
         updated_at    = now()
   where d.id = p_driver and d.org_id = p_org;

  -- The §391.21(b)(10)-(11) list becomes rows. `source = 'application'` is what 0208's column exists
  -- to say: these came from the applicant, not from an office.
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

  -- §391.51(b)(1). Dated by the certification, not by the filing: the record is evidence about when
  -- the applicant signed, and `now()` would date it to whenever the row happened to be written.
  insert into public.qualification_records
    (org_id, driver_id, kind, occurred_on, result, reference, detail)
  values
    (p_org, p_driver, 'employment_application', current_date, 'certified', v_app::text,
     jsonb_build_object('source', 'application_intake', 'application_id', v_app));

  return jsonb_build_object('application_id', v_app);
end;
$$;
