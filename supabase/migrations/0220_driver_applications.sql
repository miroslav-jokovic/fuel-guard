-- 0220 — the §391.21 application, and the invitation that carries an applicant to it (H5).
--
-- The application is the artifact everything downstream leans on. §391.21(b) closes by requiring the
-- APPLICANT to sign "that all entries on it and information in it are true and complete", which is
-- what makes it evidence rather than an office transcription (HIRING-PLAN §0, Wrong 1). The
-- cross-match compares PSP against what the driver DECLARED; if a clerk typed the list, the
-- comparison is against the clerk.
--
-- ── THE INVITATION IS A CREDENTIAL, SO IT IS STORED LIKE ONE ────────────────────────────────────
-- `invites.token` (0033) is stored in plaintext, and routes/invites.ts:308 records that it is never
-- actually presented — acceptance is authorised by the email claim instead, so the column is inert.
-- This one is different in both respects: it IS the only thing standing between an anonymous request
-- and a form that accepts a date of birth and a Social Security number, and it IS presented. So only
-- the SHA-256 goes in the table. A database leak then yields hashes, not working links, and there is
-- no way for anyone with table access — including us — to reconstruct a live invitation.
--
-- Single use and expiring, both enforced on read: `used_at` is stamped inside the submit transaction
-- (0220's `submit_driver_application`), so a link forwarded to a second person finds it spent.
create table if not exists public.application_invitations (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  -- The applicant's `drivers` row, created by the recruiter before the invitation goes out (D-HIRE5:
  -- an applicant IS a drivers row, which is what lets the evidence they produce be filed against
  -- them from the first minute rather than migrated on hire).
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  -- SHA-256 hex of the token. Never the token.
  token_hash    text not null unique,
  email         text,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  revoked_at    timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_application_invitations_driver on public.application_invitations (org_id, driver_id, created_at desc);

alter table public.application_invitations enable row level security;
-- No client policies. The public endpoint reads with the service role and presents a token; staff
-- read through the API, which org-filters itself. A browser session has no business selecting from a
-- table of credentials, even hashed ones.

-- ── THE APPLICATION ITSELF ─────────────────────────────────────────────────────────────────────
-- One row per submission, immutable. A correction is a NEW application, never an edit — the same
-- rule the qualification file follows, and for the stronger reason here: the applicant certified
-- THIS text, and a certification that can be edited afterwards certifies nothing.
create table if not exists public.driver_applications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  driver_id       uuid not null references public.drivers(id) on delete cascade,
  invitation_id   uuid references public.application_invitations(id) on delete set null,
  -- The whole certified document, exactly as submitted and validated by `driverApplicationSchema`.
  -- Stored whole rather than shredded across columns because what must be reproducible in an audit
  -- is the DOCUMENT (§390.32(d)); the projections into drivers / driver_employment_history are
  -- derived views of it and may be recomputed, but this is the thing that was signed.
  payload         jsonb not null,
  signed_name     text not null,
  certified_at    timestamptz not null default now(),
  -- ESIGN attribution evidence, same three fields `driver_authorizations` (0215) records.
  applicant_ip    text,
  applicant_user_agent text,
  --
  -- ── D-HIRE6: THE SSN ─────────────────────────────────────────────────────────────────────────
  -- §391.21(b)(2) requires it on the application. PSP does NOT need it — it matches on name, licence
  -- number, licence state and date of birth — and a SambaSafety MVR needs it or its last four. So
  -- the default posture is: keep the last four, and keep the full value ONLY sealed.
  --
  -- `ssn_sealed` is a secretBox v1 envelope (AES-256-GCM, bound to org + purpose), never a readable
  -- column, and it is NULLABLE on purpose: a carrier whose vendor accepts last-four should store no
  -- full SSN at all, and the schema must make that the easy configuration rather than a discipline.
  -- Neither field is ever logged, audited by value, or placed in a `meta` blob — the `redactCardXml`
  -- rule (9a7a125) applied to the worst case this product handles.
  ssn_last4       text check (ssn_last4 is null or ssn_last4 ~ '^[0-9]{4}$'),
  ssn_sealed      text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_driver_applications_driver on public.driver_applications (org_id, driver_id, certified_at desc);

alter table public.driver_applications enable row level security;
-- No client policies: this row carries a date of birth and, potentially, a sealed SSN. It is read
-- through the API by the roles §391.53(a)(1) describes, and by nothing else.

-- Immutable at the database level, on 0071's pattern: a certification somebody can edit afterwards
-- is not a certification. The API never updates these rows either; this is the layer that holds when
-- somebody someday writes a "fix a typo" migration.
create or replace function public.guard_driver_applications_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'driver_applications is append-only: a correction is a new application'
    using errcode = 'DA010';
end;
$$;

drop trigger if exists trg_driver_applications_append_only on public.driver_applications;
create trigger trg_driver_applications_append_only
  before update or delete on public.driver_applications
  for each row
  execute function public.guard_driver_applications_append_only();

-- ── SUBMISSION IS ONE TRANSACTION ──────────────────────────────────────────────────────────────
-- Submitting does five things, and any subset of them is a worse state than none: the application is
-- filed, the invitation is spent, the driver's identity fields are filled in from what they
-- declared, their employment list becomes rows, and the §391.51(b)(1) qualification record cites the
-- application. A submission that filed the document but left the link live invites a second person
-- to submit over it; one that spent the link but filed nothing loses the applicant's work entirely.
--
-- As with 0218, the RULES live in TypeScript (`packages/shared/src/applicationIntake.ts`) and this
-- applies what they produced. `p_employment` and `p_driver_patch` arrive already computed.
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
    (org_id, driver_id, employer_name, usdot_number, employer_city, employer_state, employer_phone,
     position_held, started_on, ended_on, dot_regulated, operated_cmv,
     subject_to_fmcsr, safety_sensitive, reason_for_leaving, inquiry_status, source)
  select p_org, p_driver, e.employer_name, e.usdot_number, e.employer_city, e.employer_state,
         e.employer_phone, e.position_held, e.started_on, e.ended_on,
         e.dot_regulated, e.operated_cmv, e.subject_to_fmcsr, e.safety_sensitive, e.reason_for_leaving,
         case when e.dot_regulated then 'pending' else 'not_required' end,
         'application'
    from jsonb_to_recordset(coalesce(p_employment, '[]'::jsonb)) as e(
           employer_name text, usdot_number text, employer_city text, employer_state text,
           employer_phone text, position_held text,
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

revoke all on function public.submit_driver_application(uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.submit_driver_application(uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb) to service_role;

comment on function public.submit_driver_application(uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb) is
  'H5: file the certified §391.21 application, spend the invitation, fill the driver identity, expand the employment list and cite the application as §391.51(b)(1) evidence — all or nothing. Refuses a spent, revoked or expired invitation (DA021).';
