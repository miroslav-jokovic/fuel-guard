-- 0229 — the rendered application, its citation, and two debts paid (APPLICATION-SYSTEM-PLAN A6).
--
-- ── 1. §391.21(b)(1): THE CARRIER'S NAME AND ADDRESS ───────────────────────────────────────────
-- Read verbatim 2026-08-21: "(b)(1) The name and address of the employing motor carrier". A3a's
-- audit found it satisfied NOWHERE — `organizations` carried a name and a dot_number and no address
-- at all — which meant the document A6 renders would be short of a paragraph the regulation names.
--
-- It is not an applicant field and never will be: the carrier's own address is a fact the server
-- knows, and D-APP9's rule is that the server composes what the server knows. So the column lands
-- here and the renderer prints it; the VALUE is an owner input (§6) and the renderer prints the name
-- alone until it arrives, which is a document missing one line rather than a document that cannot be
-- produced. Nullable for exactly that reason.
alter table public.organizations
  add column if not exists legal_address text;

comment on column public.organizations.legal_address is
  'The carrier''s address as it appears on the application, required by 49 CFR §391.21(b)(1) alongside the name. Free text and nullable: this is a single block printed on a rendered document, not something to be parsed or matched on, and an org that has not supplied one yet still produces an application.';

-- ── 2. THE §391.51(b)(1) RECORD LEARNS WHICH DOCUMENT IT CITES ─────────────────────────────────
-- `submit_driver_application` files the qualification record inside the transaction, and it must:
-- the record is evidence that the applicant certified an application on a date. The rendered PDF
-- cannot exist yet at that moment — it is drawn FROM the application row and the signatures, so it
-- is necessarily later. This RPC is the one act that closes the gap afterwards.
--
-- It is deliberately narrow. It sets `document_id` and only `document_id`, only on an
-- `employment_application` record, only where it is still null, and only for the org that owns it.
-- A general "update a qualification record" path would be a way to rewrite evidence; this can do
-- exactly one thing, and doing it twice is a no-op rather than a second answer.
create or replace function public.attach_application_document(
  p_org         uuid,
  p_application uuid,
  p_document    uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  update public.qualification_records
     set document_id = p_document
   where org_id = p_org
     and kind = 'employment_application'
     and reference = p_application::text
     and document_id is null;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.attach_application_document(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.attach_application_document(uuid, uuid, uuid) to service_role;

comment on function public.attach_application_document(uuid, uuid, uuid) is
  'A6: point the §391.51(b)(1) qualification record at the rendered application PDF. Sets document_id once and only where it is null — the PDF is a derivative and may be re-rendered, but the record cites the first one filed, and nothing here can rewrite anything else about the record.';

-- ── 3. `used_at` IS DROPPED, NOW THAT NOTHING READS IT ─────────────────────────────────────────
-- 0225 replaced the single-use fuse with three dated phase stamps and kept `used_at` as a mirror for
-- three staff-facing readers. A5 moved all three to `submitted_at` and deliberately did NOT drop the
-- column in the same migration: `migrate.yml` and Railway finish in no guaranteed order, and a
-- 2026-08-20 Railway incident held deploys in a queue for hours while CI stayed green. Had the
-- migration won that race, the deployed old code's `select … used_at` would have returned a
-- PostgREST error and broken the recruiter's invitation list until the deploy caught up.
--
-- Expand, then contract. A5's reader-free code was verified live at 0228 (`pnpm verify:live`,
-- deployment 6a1cffc7, 2026-08-21T18:57Z) before this line was written, so there is now no deployed
-- reader to break. `submitted_at` carries the same fact and has since 0225's backfill.
-- ⚠ THE FUNCTION THAT STILL WRITES IT GOES FIRST. `submit_driver_application`'s live body is 0225's,
-- and it stamps `submitted_at` AND `used_at`. Dropping the column under a function that writes to it
-- would leave every submission raising 42703 at runtime — a schema change that compiles, deploys,
-- and breaks the one unauthenticated write path in the product. The body below is 0225's with that
-- one line removed and nothing else touched.
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
  -- Revoked or expired kills the whole session, every phase of it.
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'DA021';
  end if;
  -- Spent phase, live link. The releases signed on this invitation stay reachable (that is the whole
  -- point of 0225); what cannot happen twice is the certification.
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

  -- One column now. `used_at` was the mirror 0225 kept for three staff-facing readers; A5 moved them
  -- all to `submitted_at`, and this file drops it below.
  update public.application_invitations
     set submitted_at = now()
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

alter table public.application_invitations
  drop column if exists used_at;
