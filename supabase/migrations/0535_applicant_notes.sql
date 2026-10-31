-- 0535 — notes on an applicant: the office's working papers (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P7,
-- §8.2). The reader is §9 P10.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- §8.2 measured it: there is no human layer on the applicant record — no notes table, no activity,
-- nowhere for a recruiter on the phone to write "called 10/30, sends the SSN card Monday"
-- (`git grep applicant_notes` → nothing). Every hiring tool has this; this one did not.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- `applicant_notes`: one row per note — the org, the driver, the invitation it was written during
-- (nullable: a note can be about a person between applications), the words, who wrote it (by id and
-- by name, so a note outlives its author's account) and when, and whether it is pinned to the top.
--
--   · **Append-only.** A note is never edited and never deleted — a correction is a new note — so the
--     record of what the office knew, when, stays true. The guard (AN010/AN011) refuses every UPDATE
--     except of `pinned` and of `driver_id` (the roster merge moves it, below), and every DELETE except
--     the applicant purge's. Pinning goes through `set_applicant_note_pinned`, which also unpins the
--     others: one note at the top of an applicant, not a second list.
--   · **Not evidence.** Notes are working papers, not a §391.51 record, so they are NOT in
--     `RETENTION_FORBIDDEN` (`docs/plans/recruitment/HIRING-WORKFLOW-AUDIT-2026-10-31.md` §9 P7), and
--     the applicant purge removes them with the applicant (`purge_applicant` below, PA011's list).
--   · **RLS on, no client policies** — deny-all from a browser; the API reads and writes with the
--     service role and filters on `org_id` itself (`expectOrgScoped` in P10's tests).
--   · `driver_id … on delete restrict`, not cascade — `asset_movements`' (0524) loud shape. A roster
--     merge moves the notes first (`DRIVER_REASSIGNMENTS`, `mergeDriver.ts`, listed in this PR — the
--     `merge-driver-cascade-trap`); a merge that ever forgot them would stop on the final
--     `delete from drivers` instead of silently losing them.
--
-- cross-module-waiver: the applicant purge (`purge_applicant`, recruiting's) is redefined whole to add
-- this table, and its body already deletes from evidence's, psp's and roster's tables as one audited act
-- (0380, 0387); nothing about those deletes changes here.
--
-- raw-access-waiver: `purge_applicant` is copied whole from 0387 and has always deleted the applicant's
-- `psp_requests` rows itself — the purge is the one audited act that removes everything they wrote.
--
-- ⚠ DEPLOY WINDOW: a new table, so no old reader can trip over it. The one code change in the same
-- PR is the merge list, which updates this table; a merge run in the minutes between the code
-- deploying and `migrate-staging` applying this would fail loudly on the missing table, and is an
-- admin act nobody runs on a release night.

create table if not exists public.applicant_notes (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  driver_id     uuid not null references public.drivers(id) on delete restrict,
  invitation_id uuid references public.application_invitations(id) on delete set null,
  body          text not null check (length(btrim(body)) between 1 and 4000),
  author_id     uuid references auth.users(id) on delete set null,
  author_name   text not null check (length(btrim(author_name)) between 1 and 200),
  pinned        boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.applicant_notes enable row level security;

-- The one read: an applicant's notes, pinned first, newest first.
create index if not exists ix_applicant_notes_driver
  on public.applicant_notes (org_id, driver_id, created_at desc);
-- At most one pinned note per applicant.
create unique index if not exists ux_applicant_notes_one_pinned
  on public.applicant_notes (org_id, driver_id) where pinned;

comment on table public.applicant_notes is
  '§9 P7 (0535): the office''s notes on an applicant. Append-only (AN010/AN011) except pinned and the roster merge''s driver_id; deleted only by purge_applicant. Not evidence — working papers. Service-role only (RLS, no policies).';

create or replace function public.guard_applicant_notes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant(old.driver_id) then
      return old;
    end if;
    raise exception 'applicant_notes are never deleted — write a new note instead' using errcode = 'AN010';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.body <> old.body
     or new.author_id is distinct from old.author_id or new.author_name <> old.author_name
     or new.created_at <> old.created_at or new.invitation_id is distinct from old.invitation_id then
    raise exception 'applicant_notes are never edited — write a new note instead' using errcode = 'AN011';
  end if;
  -- The roster merge moves a note to the canonical driver; it must stay in the same carrier.
  if new.driver_id <> old.driver_id
     and not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'applicant_note_driver_not_in_org' using errcode = 'AN012';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_applicant_notes on public.applicant_notes;
create trigger trg_guard_applicant_notes
  before update or delete on public.applicant_notes
  for each row execute function public.guard_applicant_notes();

-- A note's driver must be this org's — the insert-side twin of AN012.
create or replace function public.guard_applicant_notes_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'applicant_note_driver_not_in_org' using errcode = 'AN012';
  end if;
  if new.invitation_id is not null and not exists (
       select 1 from public.application_invitations i
        where i.id = new.invitation_id and i.org_id = new.org_id and i.driver_id = new.driver_id) then
    raise exception 'applicant_note_invitation_not_this_applicants' using errcode = 'AN013';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_applicant_notes_insert on public.applicant_notes;
create trigger trg_guard_applicant_notes_insert
  before insert on public.applicant_notes
  for each row execute function public.guard_applicant_notes_insert();

-- ── pinning: one column, one note at the top ──────────────────────────────────────────────────
create or replace function public.set_applicant_note_pinned(p_org uuid, p_note uuid, p_pinned boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver uuid;
begin
  select driver_id into v_driver from public.applicant_notes where id = p_note and org_id = p_org for update;
  if v_driver is null then
    raise exception 'applicant_note_not_found' using errcode = 'AN020';
  end if;
  if p_pinned then
    update public.applicant_notes set pinned = false
     where org_id = p_org and driver_id = v_driver and pinned and id <> p_note;
  end if;
  update public.applicant_notes set pinned = coalesce(p_pinned, false) where id = p_note and org_id = p_org;
  return coalesce(p_pinned, false);
end;
$$;

revoke all on function public.set_applicant_note_pinned(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_applicant_note_pinned(uuid, uuid, boolean) to service_role;

comment on function public.set_applicant_note_pinned(uuid, uuid, boolean) is
  '§9 P7 (0535): pin (unpinning the applicant''s other note) or unpin one note. AN020 not this org''s note.';

-- ── the applicant purge removes the notes too ─────────────────────────────────────────────────
-- 0387's body with `applicant_notes` added to PA011's owned list and deleted before the driver.
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
    'sms_suppressions', 'applicant_notes'];
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
  'Q-AW40: deletes an applicant who was never hired, and every row their application wrote, as one audited service-role act (the api writes driver.purged). Refuses PA010 ever hired (status, hire/termination date, or a compliance.applicant_hired audit row), PA011 rows in any drivers-referencing table it does not own or a DQ export naming them, PA012 a driver-app account or McLeod/Samsara/EFS id, PA020 not in this org, PA030 actor not an admin. Opens the seven delete guards for THIS driver only, through fuelguard.purging_applicant (transaction-local); 0387 added application_packet_countersignatures; 0535 applicant_notes. Returns {counts, storage}: the Storage paths the api must remove.';

revoke all on function public.purge_applicant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_applicant(uuid, uuid, uuid) to service_role;

