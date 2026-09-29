-- 0387 — the carrier's countersignature on the filed packet, schema only (HANDBOOK-SIGNING-PLAN.md §6,
-- QH0; Q-HB1 ruled 2026-09-29, design D-HB7..D-HB10 approved the same day).
--
-- ── THE GAP ──────────────────────────────────────────────────────────────────────────────────────
-- The carrier's packet carries four lines for the carrier, not the applicant: page 18's and page 19's
-- two `Silvicom Inc Representative:` and page 22's `Company reprsentative's signature` (`p18c`, `p19ac`,
-- `p19bc`, `p22c` in `packetPlacements.ts`). Every filed packet prints them blank. The owner ruled that
-- the Representatives (0374's `carrier_representatives`) sign them.
--
-- ── WHY A SECOND FILING, AND WHY THIS TABLE RECORDS IT ──────────────────────────────────────────
-- The packet is filed at the driver's certification, before the office acts, and a filed document is
-- never rendered again (`file.ts`). So the countersigned packet is a SECOND document: the driver's filed
-- bytes with the four marks stamped on (D-HB7/§6.2(b)). The driver's filing stays as it was, and its
-- §391.51(b)(1) record keeps citing it. This table is the fact the second document stands on: which
-- Representative, applied by which office user, when, on which lines, over which bytes.
--
-- ── WHY NOT ONE OF THE TWO MARK TABLES THAT EXIST (D-HB8) ───────────────────────────────────────
-- · `application_packet_marks`: `record_packet_mark` raises DR033 once the packet is filed. That is
--   the packet's closing seal, and loosening it for the carrier would weaken the one guard that says a
--   filed packet takes no more marks from anyone.
-- · `handbook_marks`: its placement check is `^h[0-9]+[a-z]?$` and its guard's order is the handbook's.
--   Packet ids in it would need both changed, and the table's name would lie.
--
-- ── WHY ONE ROW PER INVITATION, NOT ONE PER LINE ────────────────────────────────────────────────
-- The four lines are one act with one signature by one Representative. `placements` names the lines
-- signed, taken from the catalogue (`party = 'carrier'`) at the moment of signing, so a later ruling that
-- withdraws one is recorded rather than assumed. It may be EMPTY: an application filed as the §391.21
-- summary has no carrier lines, and its row says so (D-HB10).
--
-- ── THE ONE WRITE AFTER INSERT ──────────────────────────────────────────────────────────────────
-- The row is recorded first, then the stamped copy is filed and its id written onto it (§6.3's order,
-- so a retry keeps the Representative already recorded). `document_id` may go from null to a value
-- ONCE, to an `employment_application` document of this org and this driver. Nothing else ever changes.
--
-- ── THE ORDER THE DATABASE HOLDS (h4c's own) ────────────────────────────────────────────────────
-- PC020 invitation not in this org · PC021 link revoked or expired · PC022 application not filed ·
-- PC023 envelope not sent · PC024 handbook already filed (the countersign files the handbook LAST, so
-- after it nothing is countersigned) · PC025 Representative not of this org · PC026 application not of
-- this invitation · PC027 the document written is not this driver's filed application · PC010 anything
-- else after insert, including a cascade from the invitation (HB011's pattern).
--
-- ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────────────────────────
-- "A filed handbook implies a countersigned packet" is QH2, a later migration: shipped with the table it
-- would refuse every countersign the deployed code attempts in the deploy window. `merge_driver` needs no
-- entry: MD010 refuses a driver with a filed application, and a row cannot exist without one.
--
-- cross-module-waiver: the row cites recruiting's invitation and application, evidence's `documents` and
-- recruiting's Representative; `purge_applicant` (0380) must delete it with the rest of an applicant's
-- file, which is the whole reason that function spans modules.
-- raw-access-waiver: `purge_applicant` is 0380's body with one table added, and 0380's body deletes an
-- applicant's `psp_requests` rows (0380 carries the same waiver).

create table if not exists public.application_packet_countersignatures (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  invitation_id       uuid not null references public.application_invitations(id) on delete cascade,
  application_id      uuid not null references public.driver_applications(id),
  representative_id   uuid not null references public.carrier_representatives(id) on delete restrict,
  recorded_by         uuid not null references auth.users(id),
  placements          text[] not null
                        constraint application_packet_countersignatures_placements_check
                        check (array_to_string(placements, ',') ~ '^(p[0-9]{2}[a-z]?c(,p[0-9]{2}[a-z]?c)*)?$'),
  source_sha256       text not null
                        constraint application_packet_countersignatures_sha_check check (source_sha256 ~ '^[0-9a-f]{64}$'),
  document_id         uuid references public.documents(id),
  signed_at           timestamptz not null default now(),
  signed_ip           inet,
  signed_user_agent   text,
  created_at          timestamptz not null default now()
);

create unique index if not exists uq_application_packet_countersignatures_invitation
  on public.application_packet_countersignatures (invitation_id);
create index if not exists idx_application_packet_countersignatures_org_application
  on public.application_packet_countersignatures (org_id, application_id);

alter table public.application_packet_countersignatures enable row level security;

comment on table public.application_packet_countersignatures is
  'Q-HB1 (0387): the carrier''s countersignature on the filed packet''s carrier lines, one row per invitation. document_id is the stamped copy, written once. Append-only otherwise (PC010); order PC020..PC027.';

create or replace function public.application_packet_countersignatures_guard()
returns trigger
language plpgsql
as $$
declare
  inv record;
begin
  if TG_OP = 'DELETE' and public.purging_applicant_invitation(old.invitation_id) then
    return old;
  end if;

  if TG_OP = 'UPDATE' then
    -- The one write: the stamped copy's id, once, onto a row that has none. Every other column equal.
    if old.document_id is null and new.document_id is not null
       and (new.id, new.org_id, new.invitation_id, new.application_id, new.representative_id, new.recorded_by,
            new.placements, new.source_sha256, new.signed_at, new.signed_ip, new.signed_user_agent, new.created_at)
           is not distinct from
           (old.id, old.org_id, old.invitation_id, old.application_id, old.representative_id, old.recorded_by,
            old.placements, old.source_sha256, old.signed_at, old.signed_ip, old.signed_user_agent, old.created_at)
    then
      if not exists (
        select 1 from public.documents x
          join public.driver_applications a on a.id = new.application_id
         where x.id = new.document_id and x.org_id = new.org_id and x.kind = 'employment_application'
           and x.subject_type = 'driver' and x.subject_id = a.driver_id)
      then
        raise exception 'packet_countersignature_document_mismatch' using errcode = 'PC027';
      end if;
      return new;
    end if;
    raise exception 'application_packet_countersignatures is append-only: only document_id may be set, once'
      using errcode = 'PC010';
  end if;

  if TG_OP <> 'INSERT' then
    raise exception 'application_packet_countersignatures is append-only' using errcode = 'PC010';
  end if;

  select org_id, expires_at, revoked_at, submitted_at, signing_opened_at, handbook_filed_at
    into inv
    from public.application_invitations
   where id = new.invitation_id;

  if not found or inv.org_id <> new.org_id then
    raise exception 'packet_countersignature_invitation_not_found' using errcode = 'PC020';
  end if;
  if inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'packet_countersignature_invitation_unusable' using errcode = 'PC021';
  end if;
  if inv.submitted_at is null then
    raise exception 'packet_countersignature_application_not_filed' using errcode = 'PC022';
  end if;
  if inv.signing_opened_at is null then
    raise exception 'packet_countersignature_envelope_not_sent' using errcode = 'PC023';
  end if;
  if inv.handbook_filed_at is not null then
    raise exception 'packet_countersignature_handbook_already_filed' using errcode = 'PC024';
  end if;
  if not exists (select 1 from public.carrier_representatives r
                  where r.id = new.representative_id and r.org_id = new.org_id) then
    raise exception 'packet_countersignature_representative_not_found' using errcode = 'PC025';
  end if;
  if not exists (select 1 from public.driver_applications a
                  where a.id = new.application_id and a.org_id = new.org_id
                    and a.invitation_id = new.invitation_id) then
    raise exception 'packet_countersignature_application_mismatch' using errcode = 'PC026';
  end if;
  -- A row is born without its document: the copy is filed after the row, by the one write above.
  if new.document_id is not null then
    raise exception 'application_packet_countersignatures: document_id is written after the row, never with it'
      using errcode = 'PC010';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_application_packet_countersignatures_insert_guard on public.application_packet_countersignatures;
create trigger trg_application_packet_countersignatures_insert_guard
  before insert on public.application_packet_countersignatures
  for each row execute function public.application_packet_countersignatures_guard();

drop trigger if exists trg_application_packet_countersignatures_append_only on public.application_packet_countersignatures;
create trigger trg_application_packet_countersignatures_append_only
  before update or delete on public.application_packet_countersignatures
  for each row execute function public.application_packet_countersignatures_guard();

-- ── purge_applicant (0380's body, one table added) ─────────────────────────────────────────────
-- The new table references the invitation, the application, a document and a Representative, so it goes
-- first among the invitation's children: before the application and the documents it points at.
-- Everything else is 0380's, unchanged.
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
    'sms_suppressions'];
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
  'Q-AW40: deletes an applicant who was never hired, and every row their application wrote, as one audited service-role act (the api writes driver.purged). Refuses PA010 ever hired (status, hire/termination date, or a compliance.applicant_hired audit row), PA011 rows in any drivers-referencing table it does not own or a DQ export naming them, PA012 a driver-app account or McLeod/Samsara/EFS id, PA020 not in this org, PA030 actor not an admin. Opens the seven delete guards for THIS driver only, through fuelguard.purging_applicant (transaction-local); 0387 added application_packet_countersignatures. Returns {counts, storage}: the Storage paths the api must remove.';

revoke all on function public.purge_applicant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_applicant(uuid, uuid, uuid) to service_role;
