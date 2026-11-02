-- 0545 — the carrier's own hiring steps, and the record that each was done (HIRING-WORKFLOW-AUDIT-2026-10-31
-- §8.2 third bullet, §9.3 "the checklist editor", §10 CE1). The reader is §10 CE2: Settings → Recruiting's
-- "Your hiring steps" list, the fold, the step's drawer, the hire's list.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- The process is a TypeScript array (`hiringSteps.ts`). Its header says carrier steps "are insertable
-- anywhere"; nothing lets anyone insert one. A hair test, fingerprinting, ELD training, the fuel card or
-- the tablet issued — each is a paper release or a sticky note today, and none of them can hold the hire.
-- §8.2 sizes the honest fix as "a table, a reader and a fold change". This is the table.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- · `hiring_carrier_steps` — the carrier's list: a name, what to do, WHERE it sits (`after_step`, a
--   built-in step's key, plus `position` among the steps the carrier put after the same one), who owes
--   it, what proves it (`proof`: a tick, or a filed document), and whether the hire waits for it.
--   **Retired, never deleted** (CS010): a driver's record names the step it completed, and a list that
--   could lose a row would leave that record pointing at nothing. **What proves it never changes**
--   (CS011): a step whose done records were ticks cannot start meaning "a document is on file" — that
--   would turn every earlier tick into a missing document, or the other way round silently certify
--   one. A different proof is a different step: retire this one and add that one. Name, instructions,
--   place, owes and the hire switch are the office's to edit; retiring is one-way (CS012).
-- · `hiring_carrier_step_records` — one row per act on one applicant: `done` (with a note, and the
--   document when the step's proof is a document) or `undone` (a mistaken tick withdrawn, with why).
--   **The latest act per (driver, step) is the answer**; nothing is edited and nothing deleted, so the
--   record page can say who ticked it, who took it back, and when.
-- · `recruiting_settings.hidden_hiring_steps` — the built-in steps this carrier does not run (PSP —
--   voluntary; the trip, for a carrier that hires locally; its own handbook; the videos). **Which
--   built-ins may be hidden is decided in TypeScript, from the catalogue, not here** (§10 D-CE3): a CHECK
--   naming keys would be a second copy of `hiringSteps.ts`. The reader IGNORES any locked key the column
--   happens to hold, so a service-role write that put `drug_test` in it hides nothing — fail-safe, the
--   way a NULL RLS predicate denies.
--
-- ── WHY `after_step` IS A FORMAT CHECK, NOT A FOREIGN KEY OR A LIST ───────────────────────────────
-- The built-in steps are not rows anywhere — they are `HiringStepKey`, a closed TS union. A CHECK
-- listing the nineteen keys would be the copy this repo's "deriving beats restating" rule refuses, and
-- it would refuse the next built-in step until somebody remembered this file. So the database checks
-- the shape (`^[a-z_]{1,40}$`, never `hired` — nothing may follow the hire) and the API's contract
-- checks the value against `HIRING_STEPS`. A key the catalogue later drops reads as "at the end, before
-- the hire" (CE2's fold) rather than vanishing.
--
-- ── WHY ITS OWN RECORD TABLE, NOT A `qualification_records` KIND ─────────────────────────────────
-- 0539's reason, again: `qualification_records` is the §391.51 driver qualification FILE — its kinds
-- are read by `dqCatalogue.ts`, the binder and the restrictive policies. "Fuel card issued" is not a
-- §391.51 item, and a per-carrier kind would be an unbounded CHECK. A document a step's proof needs is
-- still filed where every paper is (`documents`, through evidence's door); the record only points at it.
--
-- ── WHY NOT `orientation_videos`-STYLE SNAPSHOTS ─────────────────────────────────────────────────
-- A record does not copy its step's name. The step's name is the office's to correct ("Hair test" →
-- "Hair follicle test") and every record should read the corrected one; what a record must not lose
-- is WHICH step, and the step is never deleted (CS010) and never changes what proves it (CS011).
--
-- ── EVIDENCE, SO APPEND-ONLY — AND STILL PURGED WITH A NEVER-HIRED APPLICANT ──────────────────
-- `hiring_carrier_step_records` follows 0535/0539's guard: never edited, never deleted, except that the
-- roster merge may move `driver_id` inside the carrier and the applicant purge (`purge_applicant`,
-- redefined below from 0539's body) deletes it with the person. `driver_id … on delete restrict` and
-- listed in `DRIVER_REASSIGNMENTS` (this PR) — the merge-driver cascade trap. In `RETENTION_FORBIDDEN`
-- (this PR): a prune would turn a done step that holds the hire back into an open one with nothing to
-- say why.
--
-- RLS on, no client policies — deny-all from a browser; the api is the one door, and every service
-- query filters on `org_id` itself.
--
-- cross-module-waiver: the applicant purge (`purge_applicant`, recruiting's) is redefined whole to add
-- this table, and its body already deletes from evidence's, psp's and roster's tables as one audited act
-- (0380, 0387, 0535, 0538, 0539); nothing about those deletes changes here.
--
-- raw-access-waiver: `purge_applicant` is copied whole from 0539 and has always deleted the applicant's
-- `psp_requests` rows itself — the purge is the one audited act that removes everything they wrote.
--
-- ⚠ DEPLOY WINDOW: two new tables (no old reader can trip over them) and one added column with a
-- default that no code names until the next merge. The one code change in the same PR is the merge
-- list, which updates the record table; a merge run in the minutes between the code deploying and
-- `migrate-staging` applying this would fail loudly on a missing table.

-- ── the carrier's list ─────────────────────────────────────────────────────────────────────────
create table if not exists public.hiring_carrier_steps (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  label        text not null check (length(btrim(label)) between 1 and 80),
  instructions text check (instructions is null or length(instructions) <= 1000),
  -- A built-in step's key (`HiringStepKey`); the API checks the value, this the shape. Never `hired`.
  after_step   text not null check (after_step ~ '^[a-z_]{1,40}$' and after_step <> 'hired'),
  position     integer not null default 0 check (position between 0 and 1000),
  -- `us` = the office does it; `them` = the applicant (or a clinic) does and the office records it.
  owes         text not null default 'us' check (owes in ('us', 'them')),
  proof        text not null default 'tick' check (proof in ('tick', 'document')),
  blocks_hire  boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  retired_at   timestamptz,
  retired_by   uuid references auth.users(id) on delete set null
);

alter table public.hiring_carrier_steps enable row level security;

create index if not exists ix_hiring_carrier_steps_org
  on public.hiring_carrier_steps (org_id, after_step, position, created_at) where retired_at is null;

comment on table public.hiring_carrier_steps is
  'HIRING-WORKFLOW-AUDIT §10 CE1 (0545): the carrier''s own hiring steps, placed after a built-in step (after_step = a HiringStepKey, checked by the API). Retired, never deleted (CS010); proof never changes (CS011) — a different proof is a different step; retiring is one-way (CS012). blocks_hire adds the step to this carrier''s hire refusal list. Service-role only (RLS, no policies).';

create or replace function public.guard_hiring_carrier_steps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'hiring_carrier_steps are never deleted — retire the step instead' using errcode = 'CS010';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.proof <> old.proof
     or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
    raise exception 'what proves a hiring step never changes — retire it and add a new step' using errcode = 'CS011';
  end if;
  if old.retired_at is not null
     and (new.retired_at is distinct from old.retired_at or new.retired_by is distinct from old.retired_by) then
    raise exception 'hiring_carrier_step_already_retired' using errcode = 'CS012';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_hiring_carrier_steps on public.hiring_carrier_steps;
create trigger trg_guard_hiring_carrier_steps
  before update or delete on public.hiring_carrier_steps
  for each row execute function public.guard_hiring_carrier_steps();

-- ── what was done, per applicant ───────────────────────────────────────────────────────────────
create table if not exists public.hiring_carrier_step_records (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  step_id          uuid not null references public.hiring_carrier_steps(id) on delete restrict,
  driver_id        uuid not null references public.drivers(id) on delete restrict,
  -- The invitation the office was working when it recorded this; null for an act outside any link.
  invitation_id    uuid references public.application_invitations(id) on delete restrict,
  act              text not null check (act in ('done', 'undone')),
  note             text check (note is null or length(note) <= 1000),
  -- The filed paper, when the step's proof is a document. `on delete restrict`: the purge deletes this
  -- row before it deletes the applicant's documents.
  document_id      uuid references public.documents(id) on delete restrict,
  recorded_by      uuid references auth.users(id) on delete set null,
  recorded_by_name text not null check (length(btrim(recorded_by_name)) between 1 and 200),
  recorded_at      timestamptz not null default now()
);

alter table public.hiring_carrier_step_records enable row level security;

create index if not exists ix_hiring_carrier_step_records_driver
  on public.hiring_carrier_step_records (org_id, driver_id, step_id, recorded_at desc);
create index if not exists ix_hiring_carrier_step_records_step
  on public.hiring_carrier_step_records (step_id);
create index if not exists ix_hiring_carrier_step_records_invitation
  on public.hiring_carrier_step_records (invitation_id) where invitation_id is not null;
create index if not exists ix_hiring_carrier_step_records_document
  on public.hiring_carrier_step_records (document_id) where document_id is not null;

comment on table public.hiring_carrier_step_records is
  'HIRING-WORKFLOW-AUDIT §10 CE1 (0545): each act on one applicant''s carrier step — done (with the filed document when the step''s proof is a document) or undone (a mistake withdrawn, with why). The latest act per (driver, step) is the answer. Append-only (CS020/CS021) except the roster merge''s driver_id; deleted only by purge_applicant. Service-role only (RLS, no policies).';

create or replace function public.guard_hiring_carrier_step_records_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_step record;
begin
  if not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'hiring_carrier_step_driver_not_in_org' using errcode = 'CS022';
  end if;
  if new.invitation_id is not null and not exists (
       select 1 from public.application_invitations i
        where i.id = new.invitation_id and i.org_id = new.org_id and i.driver_id = new.driver_id) then
    raise exception 'hiring_carrier_step_invitation_not_this_applicants' using errcode = 'CS023';
  end if;
  select s.proof, s.retired_at into v_step
    from public.hiring_carrier_steps s
   where s.id = new.step_id and s.org_id = new.org_id;
  if not found then
    -- Another carrier's step reads the same as no step.
    raise exception 'hiring_carrier_step_not_this_carriers' using errcode = 'CS024';
  end if;
  -- A retired step can still be UNDONE (a mistake found later is still a mistake), never newly done.
  if new.act = 'done' and v_step.retired_at is not null then
    raise exception 'hiring_carrier_step_retired' using errcode = 'CS025';
  end if;
  -- The proof the step asks for, and only for a done act: a document step done without its paper is
  -- the tick that certifies nothing; a tick step or an undo carries none.
  if new.act = 'done' and v_step.proof = 'document' then
    if new.document_id is null or not exists (
         select 1 from public.documents x
          where x.id = new.document_id and x.org_id = new.org_id
            and x.subject_type = 'driver' and x.subject_id = new.driver_id) then
      raise exception 'hiring_carrier_step_needs_this_drivers_document' using errcode = 'CS026';
    end if;
  elsif new.document_id is not null then
    raise exception 'hiring_carrier_step_document_not_asked_for' using errcode = 'CS027';
  end if;
  -- An undo says why: "withdrawn" with no reason is the record page's dead end.
  if new.act = 'undone' and coalesce(length(btrim(new.note)), 0) = 0 then
    raise exception 'hiring_carrier_step_undo_needs_a_reason' using errcode = 'CS028';
  end if;
  new.recorded_at := now();
  return new;
end;
$$;

drop trigger if exists trg_guard_hiring_carrier_step_records_insert on public.hiring_carrier_step_records;
create trigger trg_guard_hiring_carrier_step_records_insert
  before insert on public.hiring_carrier_step_records
  for each row execute function public.guard_hiring_carrier_step_records_insert();

create or replace function public.guard_hiring_carrier_step_records()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant(old.driver_id) then
      return old;
    end if;
    raise exception 'hiring_carrier_step_records are never deleted' using errcode = 'CS020';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.step_id <> old.step_id
     or new.invitation_id is distinct from old.invitation_id or new.act <> old.act
     or new.note is distinct from old.note or new.document_id is distinct from old.document_id
     or new.recorded_by is distinct from old.recorded_by or new.recorded_by_name <> old.recorded_by_name
     or new.recorded_at <> old.recorded_at then
    raise exception 'hiring_carrier_step_records are never edited' using errcode = 'CS021';
  end if;
  -- The roster merge moves a record to the canonical driver; it must stay in the same carrier.
  if new.driver_id <> old.driver_id
     and not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'hiring_carrier_step_driver_not_in_org' using errcode = 'CS022';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_hiring_carrier_step_records on public.hiring_carrier_step_records;
create trigger trg_guard_hiring_carrier_step_records
  before update or delete on public.hiring_carrier_step_records
  for each row execute function public.guard_hiring_carrier_step_records();

-- ── the built-in steps this carrier does not run ───────────────────────────────────────────────
alter table public.recruiting_settings
  add column if not exists hidden_hiring_steps text[] not null default '{}'
    check (cardinality(hidden_hiring_steps) <= 40);

comment on column public.recruiting_settings.hidden_hiring_steps is
  'HIRING-WORKFLOW-AUDIT §10 CE1 (0545): built-in step keys this carrier does not run. Which keys MAY be hidden is decided by the API from hiringSteps.ts (D-CE3) — the six federal checks, the consents and the application itself never; the checklist reader ignores any locked key found here. Default empty.';

-- ── the applicant purge removes the record table too ───────────────────────────────────────────
-- 0539's body with `hiring_carrier_step_records` added to PA011's owned list and deleted before the
-- documents, invitations and driver it points at.
create or replace function public.purge_applicant(p_org uuid, p_driver uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The tables this function deletes from BY `driver_id`. Every other table referencing drivers(id)
  -- must be empty for this driver, or the purge refuses (PA011). `sms_suppressions` is here only so
  -- that its SET NULL is allowed to happen: the row is kept (see the header).
  v_owned constant text[] := array[
    'application_invitations', 'driver_applications', 'driver_authorizations', 'esign_consents',
    'application_drafts', 'application_captures', 'driver_employment_history', 'employer_inquiries',
    'psp_requests', 'qualification_records', 'applicant_dispositions', 'sms_consents', 'sms_outbox',
    'sms_suppressions', 'applicant_notes', 'driver_employment_gaps', 'orientation_video_attestations',
    'orientation_video_opens', 'hiring_carrier_step_records'];
  v_driver record;
  v_invitations uuid[];
  v_fk record;
  v_found boolean;
  v_counts jsonb := '{}'::jsonb;
  v_storage jsonb;
  v_n bigint;
begin
  if p_org is null or p_driver is null or p_actor is null then
    raise exception 'purge_applicant: org, driver and actor are all required' using errcode = 'PA020';
  end if;

  -- Admin only (the ruling). The api checks it first; this is the same fact read again at the one
  -- place an irreversible act happens, because the service role bypasses everything else.
  if not exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = p_actor and m.role = 'admin') then
    raise exception 'purge_applicant_not_admin: only an admin of the carrier may delete an applicant'
      using errcode = 'PA030';
  end if;

  -- Locked, so a hire racing this purge waits for it and then finds no row, rather than the purge
  -- deleting somebody hired a millisecond earlier.
  select d.id, d.status, d.hire_date, d.termination_date, d.user_id, d.mcleod_driver_id,
         d.samsara_driver_id, d.efs_driver_id, d.photo_path, d.created_at
    into v_driver
    from public.drivers d
   where d.id = p_driver and d.org_id = p_org
     for update;
  if not found then
    -- Cross-org lands here too, deliberately in the same words: another carrier's driver id is
    -- indistinguishable from no driver at all.
    raise exception 'purge_applicant_not_found: driver % not found in org %', p_driver, p_org
      using errcode = 'PA020';
  end if;

  if v_driver.status <> 'applicant'
     or v_driver.hire_date is not null
     or v_driver.termination_date is not null
     or exists (select 1 from public.audit_logs a
                 where a.org_id = p_org
                   and a.created_at >= v_driver.created_at
                   and a.action = 'compliance.applicant_hired'
                   and a.entity_id = p_driver)
  then
    raise exception 'purge_applicant_was_hired: driver % was hired; a qualification file is kept for the length of employment plus three years (§391.51)', p_driver
      using errcode = 'PA010';
  end if;

  if v_driver.user_id is not null or v_driver.mcleod_driver_id is not null
     or v_driver.samsara_driver_id is not null or v_driver.efs_driver_id is not null then
    raise exception 'purge_applicant_linked: driver % has a driver-app account or a McLeod, Samsara or EFS id', p_driver
      using errcode = 'PA012';
  end if;

  for v_fk in
    -- By name and schema, not `regclass::text`: under this function's empty search_path that text is
    -- schema-qualified and would never equal a name in v_owned.
    select n.nspname as nsp, r.relname as tbl, a.attname as col
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class r on r.oid = c.conrelid
      join pg_catalog.pg_namespace n on n.oid = r.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'public.drivers'::regclass
     order by 2, 3
  loop
    continue when v_fk.nsp = 'public' and v_fk.tbl = any (v_owned);
    execute format('select exists (select 1 from %I.%I where %I = $1)', v_fk.nsp, v_fk.tbl, v_fk.col)
      into v_found using p_driver;
    if v_found then
      raise exception 'purge_applicant_has_records: driver % has rows in %.%.%, which an applicant''s purge does not own', p_driver, v_fk.nsp, v_fk.tbl, v_fk.col
        using errcode = 'PA011';
    end if;
  end loop;
  if exists (select 1 from public.dq_exports x where x.org_id = p_org and p_driver = any (x.driver_ids)) then
    raise exception 'purge_applicant_has_records: driver % is named in a DQ export', p_driver
      using errcode = 'PA011';
  end if;

  select coalesce(array_agg(i.id), '{}') into v_invitations
    from public.application_invitations i
   where i.driver_id = p_driver and i.org_id = p_org;

  -- Read before the rows go: the paths are the only way P2 can find the objects afterwards.
  select jsonb_build_object(
    'documents', coalesce((select jsonb_agg(x.storage_path order by x.storage_path) from public.documents x
                            where x.org_id = p_org and x.subject_type = 'driver' and x.subject_id = p_driver
                              and x.storage_path is not null), '[]'::jsonb),
    'application_captures', coalesce((select jsonb_agg(x.storage_path order by x.storage_path) from public.application_captures x
                            where x.driver_id = p_driver and x.storage_path is not null), '[]'::jsonb),
    'signature_adoptions', coalesce((select jsonb_agg(x.storage_path order by x.storage_path) from public.signature_adoptions x
                            where x.invitation_id = any (v_invitations) and x.storage_path is not null), '[]'::jsonb),
    'drivers', case when v_driver.photo_path is null then '[]'::jsonb else jsonb_build_array(v_driver.photo_path) end)
    into v_storage;

  perform set_config('fuelguard.purging_applicant', p_driver::text, true);

  -- Children of the invitations first, the RESTRICT edges' order: whatever points at an adoption or
  -- an inquiry goes before it.
  -- 0387: the countersignature points at the application and a document, so it goes before both.
  delete from public.application_packet_countersignatures where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_packet_countersignatures', v_n);
  delete from public.employer_verification_calls where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('employer_verification_calls', v_n);
  delete from public.handbook_marks where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('handbook_marks', v_n);
  delete from public.application_packet_marks where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_packet_marks', v_n);
  -- `revokes` (a self-reference, RESTRICT) needs no ordering: a revocation and the authorization it
  -- revokes go in this one statement, and RESTRICT is checked at the statement's end.
  delete from public.driver_authorizations where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_authorizations', v_n);
  delete from public.signature_adoptions where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('signature_adoptions', v_n);
  delete from public.driver_applications where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_applications', v_n);
  delete from public.esign_consents where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('esign_consents', v_n);
  delete from public.application_edits where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_edits', v_n);
  delete from public.application_intake_licences where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_intake_licences', v_n);
  delete from public.application_intakes where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_intakes', v_n);
  delete from public.drug_test_appointments where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('drug_test_appointments', v_n);
  delete from public.applicant_travel where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('applicant_travel', v_n);
  delete from public.application_screen_events where invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_screen_events', v_n);
  delete from public.application_drafts where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_drafts', v_n);
  delete from public.application_captures where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_captures', v_n);
  delete from public.sms_outbox where driver_id = p_driver or invitation_id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sms_outbox', v_n);

  -- The recruiting record held by the driver.
  delete from public.employer_inquiries where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('employer_inquiries', v_n);
  delete from public.driver_employment_history where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_employment_history', v_n);
  delete from public.psp_requests where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('psp_requests', v_n);
  delete from public.qualification_records where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('qualification_records', v_n);
  delete from public.applicant_dispositions where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('applicant_dispositions', v_n);
  delete from public.sms_consents where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('sms_consents', v_n);
  -- 0535: the office's notes go with the applicant — a purge that left them would leave the person.
  delete from public.applicant_notes where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('applicant_notes', v_n);
  -- 0538: the gaps the office recorded go with the applicant, for the same reason.
  delete from public.driver_employment_gaps where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('driver_employment_gaps', v_n);
  -- 0539: the applicant's "I watched these" and the links they opened go with the applicant. Before
  -- `application_invitations` below: both point at an invitation, on delete restrict.
  delete from public.orientation_video_attestations where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('orientation_video_attestations', v_n);
  delete from public.orientation_video_opens where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('orientation_video_opens', v_n);
  -- 0545: what the office recorded on the carrier's own steps goes with the applicant. Before `documents`
  -- (a document step's record points at the filed paper) and the invitations, both on delete restrict.
  delete from public.hiring_carrier_step_records where driver_id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('hiring_carrier_step_records', v_n);

  -- Polymorphic references (no FK): after every row that points at a document.
  delete from public.certifications where org_id = p_org and subject_type = 'driver' and subject_id = p_driver;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('certifications', v_n);
  -- `derived_from` is the same: a thumbnail and its original go in one statement.
  delete from public.documents where org_id = p_org and subject_type = 'driver' and subject_id = p_driver;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('documents', v_n);

  delete from public.application_invitations where id = any (v_invitations);
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('application_invitations', v_n);

  delete from public.drivers where id = p_driver and org_id = p_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('drivers', v_n);

  perform set_config('fuelguard.purging_applicant', '', true);

  return jsonb_build_object('counts', v_counts, 'storage', v_storage);
end;
$$;

comment on function public.purge_applicant(uuid, uuid, uuid) is
  'Q-AW40: deletes an applicant who was never hired, and every row their application wrote, as one audited service-role act (the api writes driver.purged). Refuses PA010 ever hired (status, hire/termination date, or a compliance.applicant_hired audit row), PA011 rows in any drivers-referencing table it does not own or a DQ export naming them, PA012 a driver-app account or McLeod/Samsara/EFS id, PA020 not in this org, PA030 actor not an admin. Opens the seven delete guards for THIS driver only, through fuelguard.purging_applicant (transaction-local); 0387 added application_packet_countersignatures; 0535 applicant_notes; 0538 driver_employment_gaps; 0539 orientation_video_attestations and orientation_video_opens; 0545 hiring_carrier_step_records. Returns {counts, storage}: the Storage paths the api must remove.';

revoke all on function public.purge_applicant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_applicant(uuid, uuid, uuid) to service_role;
