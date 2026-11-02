-- 0538 — the gaps in a driver's work history that the office records after the application is
-- signed (HIRING-WORKFLOW-AUDIT-2026-10-31 §3.4, §4.5, §5 HW5c). The reader is HW5c's second PR.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- §3.4 measured three stores for one job list: the applicant's draft (editable), the filed
-- application (`driver_applications.payload`, frozen) and `driver_employment_history` (the office's
-- working copy, written at filing, 0376). Gap explanations live ONLY in the filed payload. So once
-- the application is signed, an unexplained gap the office finds — on the phone with the driver, or
-- because a previous employer gave different dates — has nowhere to be written. Today the recruiter
-- keeps it in their head or in a note, and the DQ file shows the gap unexplained.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- `driver_employment_gaps`: one row per gap the OFFICE recorded after signing — the dates, the
-- driver's explanation in their words, who recorded it (id and name, so it outlives the account) and
-- when. The reader shows it on the timeline as "added by {name} on {date}, after signing" (§4.5).
--
--   · **Only the office's, never a copy of the applicant's.** The gaps the applicant explained stay in
--     the filed application, which the reader reads; copying them here at filing would be a second
--     store of one fact (the audit's complaint) and would mean redefining 0376's filing function.
--   · **Append-only, withdrawable.** A recorded explanation is part of what the carrier relied on, so
--     it is never edited or deleted (EG010/EG011). A mistaken row is WITHDRAWN — `withdrawn_at`,
--     `withdrawn_by`, set once — and the reader stops counting it; a correction is a new row. Only
--     the applicant purge deletes, and the roster merge may move `driver_id`.
--   · **RLS on, no client policies** — the API is the door and filters on `org_id` itself.
--   · `driver_id … on delete restrict` (0535's loud shape): the roster merge moves the rows first
--     (`DRIVER_REASSIGNMENTS`, in this PR), and the applicant purge deletes them (below).
--
-- ── WHAT WAS REJECTED ──────────────────────────────────────────────────────────────────────────
-- · Gap rows in `driver_employment_history` with a `kind`: that table is employers, joined to PSP
--   on `usdot_number` and to the §391.23 inquiry queue; a gap row would be one more thing for each of
--   those readers to filter out, and the first one that forgot would send a gap an inquiry.
-- · Mutable rows: the history table is mutable because it is a transcription; this is the driver's
--   statement, taken down by the office, and "who said what, when" is the point of keeping it.
--
-- cross-module-waiver: the applicant purge (`purge_applicant`, recruiting's) is redefined whole to add
-- this table, and its body already deletes from evidence's, psp's and roster's tables as one audited act
-- (0380, 0387, 0535); nothing about those deletes changes here.
--
-- raw-access-waiver: `purge_applicant` is copied whole from 0535 and has always deleted the applicant's
-- `psp_requests` rows itself — the purge is the one audited act that removes everything they wrote.
--
-- ⚠ DEPLOY WINDOW: a new table, so no old reader can trip over it. The one code change in the same
-- PR is the merge list, which updates this table; a merge run in the minutes between the code
-- deploying and `migrate-staging` applying this would fail loudly on the missing table.

create table if not exists public.driver_employment_gaps (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  driver_id         uuid not null references public.drivers(id) on delete restrict,
  started_on        date not null,
  ended_on          date not null,
  explanation       text not null check (length(btrim(explanation)) between 1 and 2000),
  recorded_by       uuid references auth.users(id) on delete set null,
  recorded_by_name  text not null check (length(btrim(recorded_by_name)) between 1 and 200),
  created_at        timestamptz not null default now(),
  withdrawn_at      timestamptz,
  withdrawn_by      uuid references auth.users(id) on delete set null,
  constraint driver_employment_gaps_dates_ordered check (ended_on >= started_on)
);

alter table public.driver_employment_gaps enable row level security;

create index if not exists ix_driver_employment_gaps_driver
  on public.driver_employment_gaps (org_id, driver_id, started_on desc);

comment on table public.driver_employment_gaps is
  'HW5c (0538): employment gaps the office recorded after the application was signed, in the driver''s words. Append-only (EG010/EG011); a mistaken row is withdrawn (withdrawn_at, once), not edited; deleted only by purge_applicant. The applicant''s own gap explanations stay in the filed application. Service-role only (RLS, no policies).';

create or replace function public.guard_driver_employment_gaps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant(old.driver_id) then
      return old;
    end if;
    raise exception 'driver_employment_gaps are never deleted — withdraw the row instead' using errcode = 'EG010';
  end if;
  if new.id <> old.id or new.org_id <> old.org_id or new.started_on <> old.started_on
     or new.ended_on <> old.ended_on or new.explanation <> old.explanation
     or new.recorded_by is distinct from old.recorded_by or new.recorded_by_name <> old.recorded_by_name
     or new.created_at <> old.created_at then
    raise exception 'driver_employment_gaps are never edited — record a new gap instead' using errcode = 'EG011';
  end if;
  if old.withdrawn_at is not null
     and (new.withdrawn_at is distinct from old.withdrawn_at or new.withdrawn_by is distinct from old.withdrawn_by) then
    raise exception 'driver_employment_gap_already_withdrawn' using errcode = 'EG012';
  end if;
  if new.driver_id <> old.driver_id
     and not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'driver_employment_gap_driver_not_in_org' using errcode = 'EG013';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_driver_employment_gaps on public.driver_employment_gaps;
create trigger trg_guard_driver_employment_gaps
  before update or delete on public.driver_employment_gaps
  for each row execute function public.guard_driver_employment_gaps();

create or replace function public.guard_driver_employment_gaps_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.drivers d where d.id = new.driver_id and d.org_id = new.org_id) then
    raise exception 'driver_employment_gap_driver_not_in_org' using errcode = 'EG013';
  end if;
  if new.withdrawn_at is not null or new.withdrawn_by is not null then
    raise exception 'driver_employment_gap_born_withdrawn' using errcode = 'EG014';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_driver_employment_gaps_insert on public.driver_employment_gaps;
create trigger trg_guard_driver_employment_gaps_insert
  before insert on public.driver_employment_gaps
  for each row execute function public.guard_driver_employment_gaps_insert();

-- 0535's body with `driver_employment_gaps` added to PA011's owned list and deleted before the driver.
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
    'sms_suppressions', 'applicant_notes', 'driver_employment_gaps'];
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
  'Q-AW40: deletes an applicant who was never hired, and every row their application wrote, as one audited service-role act (the api writes driver.purged). Refuses PA010 ever hired (status, hire/termination date, or a compliance.applicant_hired audit row), PA011 rows in any drivers-referencing table it does not own or a DQ export naming them, PA012 a driver-app account or McLeod/Samsara/EFS id, PA020 not in this org, PA030 actor not an admin. Opens the seven delete guards for THIS driver only, through fuelguard.purging_applicant (transaction-local); 0387 added application_packet_countersignatures; 0535 applicant_notes; 0538 driver_employment_gaps. Returns {counts, storage}: the Storage paths the api must remove.';

revoke all on function public.purge_applicant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_applicant(uuid, uuid, uuid) to service_role;
