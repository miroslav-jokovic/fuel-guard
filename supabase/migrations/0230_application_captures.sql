-- 0230 — the applicant's own photographs, staged and filed only at submit (APPLICATION-SYSTEM-PLAN
-- A8, D-APP10).
--
-- ── THE ARGUMENT FOR A SECOND TABLE AND A SECOND BUCKET ────────────────────────────────────────
-- The owner's framing asked for one thing this system could not do: "a flow so the driver can take
-- images of all documents necessary, from the same link". `documents` + `compliance-docs` (0146) is
-- the pipeline that files a scan — register, signed upload, signed read — and it would have worked.
-- It is the wrong place to point an applicant at, for two reasons that are the same reason twice:
--
--   1. `documents` is APPEND-ONLY and in `RETENTION_FORBIDDEN`. A driver photographing a licence in a
--      truck-stop car park will take three attempts at it. Three attempts must not become three rows
--      in a §391.51 qualification file, and there is deliberately no path that could remove the two
--      that were superseded — the whole point of that table is that nothing rewrites it.
--   2. A candidate who fills in half an application and takes another job must leave NOTHING in an
--      evidence bucket. Under 0146's pipeline their licence photograph would be filed the moment it
--      was uploaded, for a person who never applied.
--
-- So captures land HERE — one row per slot, replaceable, prunable, cascading from the invitation —
-- and `submit_driver_application` promotes the accepted set into `documents` inside the transaction
-- that files the certified application. A consequence that is a feature: an abandoned application
-- produces no evidence row at all.
--
-- ── OPERATIONAL, NOT EVIDENCE — 0226'S ARGUMENT, APPLIED AGAIN ─────────────────────────────────
-- 0213's guard style (`auth_role() is null` PASSES, which is the service role) and NOT the
-- EI010/DA010 family. The EI010 style is correct for evidence — nothing may rewrite it, ever — and
-- would make the "prunable" promise structurally false: a re-shoot REPLACES its slot, and A11's
-- retention rule runs as the service role. A trigger refusing them would leave a table that can only
-- grow, holding photographs of licences for people who never applied.
-- This table is deliberately absent from `RETENTION_FORBIDDEN` (`apps/api/src/services/dataRetention.ts`).
--
-- ── THE ROW IS WRITTEN AFTER THE BYTES, NOT BEFORE ────────────────────────────────────────────
-- 0146's `registerDocument` writes the row and hands back the upload URL in one call, so a browser
-- whose PUT then fails leaves a row pointing at nothing. For evidence that is the right way round:
-- the claim that a document exists must outlive a lost connection, and the orphan reconcile flags a
-- missing object loudly as possible evidence loss (D13). For staging it is exactly backwards. A row
-- here means "this photograph is in the bucket", so the API mints the signed URL WITHOUT writing, and
-- writes only once it has read the object back. A failed upload therefore leaves bytes nobody
-- registered — collected by the nightly orphan sweep after its 24-hour grace — and never a slot the
-- driver is told is filled when it is not.
create table if not exists public.application_captures (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  -- Cascade from the invitation, not from the driver: a capture belongs to ONE application session.
  -- Revoking or deleting the invitation takes the staged photographs with it, with no service code
  -- involved and nothing to forget — the same collection mechanism 0226 relies on for drafts.
  invitation_id uuid not null references public.application_invitations(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete cascade,
  -- The closed slot set. NOT `DOCUMENT_KINDS`: an applicant is answering "photograph these four
  -- things", not filing a qualification file, and an unauthenticated caller must not be able to name
  -- the carrier's whole filing vocabulary. `cdl_front`/`cdl_back` are two photographs of ONE document
  -- and become one kind at two pages; the mapping lives in TypeScript
  -- (`APPLICATION_CAPTURE_DOCUMENT_KIND`), on 0218/0220's division of where a vocabulary belongs.
  slot          text not null check (slot in (
                  'cdl_front','cdl_back','medical_card','ssn_card','signature_mark','other')),
  storage_path  text not null,
  -- What a phone camera can hand us after the provider has re-encoded it through a canvas (which is
  -- what strips EXIF), plus PNG for the signature canvas. A strict subset of `documents`' own list:
  -- nothing on this path produces a PDF or a HEIC, and a content type nothing produces is one
  -- nothing has tested.
  content_type  text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  -- Read back from Storage at confirm rather than taken from the request, so the row records what the
  -- object IS. Nullable because Storage may not report it, and a wrong number is worse than none.
  bytes         bigint check (bytes is null or bytes > 0),
  -- The client's claim about bytes the API never sees — the same integrity evidence, computed the
  -- same way and with the same caveat, as every document registered through 0146.
  sha256        text not null,
  captured_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  -- ONE row per slot. A re-shoot REPLACES rather than accumulating (D-APP10) — this is the constraint
  -- that makes "three attempts at a blurry licence" a single filed document.
  unique (invitation_id, slot)
);

-- "What has this session collected?" — the read behind every `GET /:token` and the promotion at
-- submit. Covered by the unique constraint's index for lookups BY slot; this one is the whole-slot
-- scan for one invitation, org-scoped because the service role bypasses RLS and every query on this
-- path carries its own tenant filter.
create index if not exists idx_application_captures_session
  on public.application_captures (org_id, invitation_id);

alter table public.application_captures enable row level security;
-- No client policies — deny-all, API-only, the posture `application_invitations`, `driver_applications`
-- and `application_drafts` all take. The only writer is the public token surface, which resolves the
-- org from the presented token server-side and never accepts one from a request.

comment on table public.application_captures is
  'A8/D-APP10: the photographs an applicant takes from the application link, STAGED. Operational, not evidence — prunable by design (0213-style guard, cascade from the invitation, deliberately absent from RETENTION_FORBIDDEN). One row per slot: a re-shoot replaces. Promoted into `documents` only by submit_driver_application, so an abandoned application leaves no evidence row.';
comment on column public.application_captures.slot is
  'What the driver was asked for, not what the file will call it. The slot -> DocumentKind mapping is APPLICATION_CAPTURE_DOCUMENT_KIND in @fuelguard/shared; cdl_front and cdl_back are two pages of one cdl.';
comment on column public.application_captures.sha256 is
  'Integrity evidence for §390.32(c), computed in the browser before the upload. The bytes never traverse the API, so this is the client''s claim — as it is for every document registered since 0146 — and it is carried forward onto the promoted `documents` row unchanged.';

-- ── THE GUARD: PRUNABLE AND REPLACEABLE BY THE SERVICE, IMMUTABLE TO EVERYONE ELSE ─────────────
-- 0226's trigger, for 0226's reason. RLS with no policies already refuses a browser session outright;
-- this is the second lock and the statement of intent for whoever later wonders whether a client was
-- ever meant to write here.
create or replace function public.guard_application_captures_client_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.auth_role() is not null then
    raise exception 'application_captures is written only by the application API'
      using errcode = 'DA040';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_guard_application_captures on public.application_captures;
create trigger trg_guard_application_captures
  before update or delete on public.application_captures
  for each row
  execute function public.guard_application_captures_client_writes();

-- ── STAGING ONE PHOTOGRAPH: THE SLOT IS REPLACED, NOT ADDED TO ─────────────────────────────────
-- Delete-then-insert rather than an UPDATE, and deliberately: each capture gets a fresh id and
-- therefore a fresh storage key, so a re-shoot never overwrites an object that a request already in
-- flight might be reading, and the extension is free to change when the browser falls back from WebP
-- to JPEG. The superseded object's path is RETURNED so the caller can remove it; if that removal
-- fails the object is simply an orphan, which the nightly sweep collects.
--
-- Written as an explicit RPC and NOT as a partial `.upsert()`, which the root CLAUDE.md forbids and
-- `lint:upserts` enforces (0174's incident: Postgres evaluates NOT NULL on the proposed tuple BEFORE
-- conflict arbitration). The `unique_violation` handler is the race, not a formality: two confirms
-- for the same slot can both delete and both insert. The loser retries once, and last write wins,
-- which is the correct semantic for a re-shoot — both came from the same driver, and the later one is
-- the photograph on their screen.
create or replace function public.stage_application_capture(
  p_org          uuid,
  p_invitation   uuid,
  p_driver       uuid,
  p_capture      uuid,
  p_slot         text,
  p_path         text,
  p_content_type text,
  p_bytes        bigint,
  p_sha256       text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_replaced text;
  v_captured timestamptz;
begin
  delete from public.application_captures
   where invitation_id = p_invitation and org_id = p_org and slot = p_slot
   returning storage_path into v_replaced;

  begin
    insert into public.application_captures
      (id, org_id, invitation_id, driver_id, slot, storage_path, content_type, bytes, sha256)
    values
      (p_capture, p_org, p_invitation, p_driver, p_slot, p_path, p_content_type, p_bytes, p_sha256)
    returning captured_at into v_captured;
  exception when unique_violation then
    delete from public.application_captures
     where invitation_id = p_invitation and org_id = p_org and slot = p_slot
     returning storage_path into v_replaced;
    insert into public.application_captures
      (id, org_id, invitation_id, driver_id, slot, storage_path, content_type, bytes, sha256)
    values
      (p_capture, p_org, p_invitation, p_driver, p_slot, p_path, p_content_type, p_bytes, p_sha256)
    returning captured_at into v_captured;
  end;

  return jsonb_build_object('capture_id', p_capture, 'captured_at', v_captured, 'replaced_path', v_replaced);
end;
$$;

revoke all on function public.stage_application_capture(uuid, uuid, uuid, uuid, text, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.stage_application_capture(uuid, uuid, uuid, uuid, text, text, text, bigint, text)
  to service_role;

comment on function public.stage_application_capture(uuid, uuid, uuid, uuid, text, text, text, bigint, text) is
  'A8: stage one photograph for one slot on one invitation, replacing whatever that slot held and returning the superseded storage path so the caller can collect it. Never a partial upsert (lint:upserts, 0174''s incident).';

-- ── THE STAGING BUCKET ─────────────────────────────────────────────────────────────────────────
-- Private, and with NO client write policy at all — not even the org-scoped one `compliance-docs`
-- carries. Every upload here happens through a signed upload URL minted by the API from a resolved
-- invitation token, by somebody who has no account and no JWT for a policy to read. The 8 MB ceiling
-- is far above what the capture provider produces (it downscales to the config long edge and encodes
-- at WebP q80) and far below what a leaked link could be used to store.
insert into storage.buckets (id, name, public, file_size_limit)
values ('application-captures', 'application-captures', false, 8 * 1024 * 1024)
on conflict (id) do nothing;

-- ── PROMOTION: THE CERTIFIED APPLICATION IS WHAT MAKES A PHOTOGRAPH EVIDENCE ───────────────────
-- ⚠ The live body is 0229's (which was 0225's, minus the `used_at` write). This is that body with one
-- new statement and one new parameter; nothing else is touched.
--
-- ⚠ AND THE SIGNATURE IS WIDENED BY DROP-THEN-CREATE, NOT BY `create or replace`. Postgres identifies
-- a function by (name, argument types), so `create or replace` with an extra parameter creates a
-- SECOND function rather than replacing the first — and a call naming eleven arguments would then
-- match both (the twelfth has a default) and fail as ambiguous. The old signature is therefore
-- dropped. `p_captures` defaults to an empty array for the deploy race 0229's header describes: if
-- this migration lands before the API that passes it, the deployed old code's eleven-argument call
-- resolves to this function with the default and behaves exactly as it did. The API's half of the
-- same race is that it OMITS the parameter when there is nothing to promote, which is every
-- submission that exists today.
drop function if exists public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb);

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
  -- all to `submitted_at`, and 0229 dropped it.
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

  -- A8/D-APP10. The staged photographs become filed documents HERE, inside the transaction that files
  -- the certified application, so the two exist together or not at all. The caller has already copied
  -- the objects into `compliance-docs` — bytes cannot be moved from SQL — and a copy whose transaction
  -- then rolls back leaves an object nobody references, which the nightly reconcile collects. That is
  -- the safe direction: this can cost bytes we could have deleted, never a row citing evidence that
  -- is not there.
  --
  -- The JOIN is not decoration. It is what makes the caller's array unable to file anything that is
  -- not a real staged capture of THIS invitation, and `documents.id = ac.id` is what makes promotion
  -- exactly-once: the filed document IS the staged capture, by identity, so a replayed copy cannot
  -- produce a second row. `kind` and `page` come from the array because the slot vocabulary lives in
  -- TypeScript (0218/0220's division), and both are checked by `documents`' own constraints.
  insert into public.documents
    (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, page,
     captured_at, uploaded_by)
  select ac.id, p_org, 'driver', p_driver, c.kind, c.storage_path, ac.content_type, ac.bytes,
         ac.sha256, c.page, ac.captured_at,
         -- Nobody in the carrier uploaded these: the applicant photographed them, and a staff id here
         -- would misattribute the file to whoever happened to open the page.
         null::uuid
    from jsonb_to_recordset(coalesce(p_captures, '[]'::jsonb)) as c(
           capture_id uuid, kind text, page int, storage_path text)
    join public.application_captures ac
      on ac.id = c.capture_id and ac.invitation_id = p_invitation and ac.org_id = p_org;

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

revoke all on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb)
  to service_role;

comment on function public.submit_driver_application(
  uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb, jsonb) is
  'H5/A8: file the certified §391.21 application, spend the submit phase, patch the driver, project the employment history, promote the staged captures into `documents`, and record the §391.51(b)(1) qualification record — one transaction. p_captures defaults to an empty array so an eleven-argument call from a not-yet-deployed API behaves exactly as it did before A8.';
