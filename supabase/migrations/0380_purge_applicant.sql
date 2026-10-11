-- 0380 — an applicant who was never hired can be deleted outright, by an admin (Q-AW40, P1).
--
-- ── THE RULING, AND THE RULE IT IS AN EXCEPTION TO ─────────────────────────────────────────────
-- Owner, 2026-09-28: test applicants, and applicants generally, are deleted outright by an admin.
-- Archiving (`drivers.archived_at`, 0235) hides a row and keeps it, and nothing in the product could
-- delete one: `trg_guard_driver_hard_delete` refuses DR010 except inside `merge_driver`, and five of
-- the tables an application writes refuse a delete by trigger, service role included.
--
-- CLAUDE.md's rule for evidence tables is that deletions are "explicit audited service-role acts,
-- never side effects". **This function is that act, for applicants only.** It is service-role only,
-- it is called by one api route (P2) that requires an admin, step-up and the typed name, and that
-- route writes one `audit_logs` row, `driver.purged`, carrying ids and the counts this returns —
-- never the name. `drivers`, `documents`, `certifications` and `qualification_records` stay in
-- RETENTION_FORBIDDEN: no sweep, no prune and no cascade may reach them. A named, refusing, audited
-- call does.
--
-- ── WHY NEVER A DRIVER WHO WAS HIRED ──────────────────────────────────────────────────────────────
-- §391.51 keeps a driver's qualification file for the length of employment plus three years, so a
-- hired driver's file is evidence the carrier owes an auditor. The refusal is part of the ruling as
-- built (§11 Q-AW40), not a detail. "Ever hired" is read from four facts, and any one refuses (PA010):
--
--   • `status <> 'applicant'` — 0238: "was this person hired?" is a question about `drivers`, and
--     `hire_applicant` (0218) is the pipeline's only exit. active, inactive, on_leave and terminated
--     are all states only a hire reaches.
--   • `hire_date` or `termination_date` set — the dates a hire and its end write.
--   • an `audit_logs` row `compliance.applicant_hired` for this driver — routes/hire.ts writes it on
--     every hire. It is the one DURABLE trace: 0213 lets an admin edit `status` and the dates back
--     through PostgREST, and a driver edited back to 'applicant' would pass the first two. Audit rows
--     are append-only. The read is bounded below by the driver's `created_at` (a hire cannot precede
--     the row), so it walks `idx_audit_org_time` over this driver's lifetime, not the org's history.
--
-- and two more refusals, because they are also evidence the person was more than an applicant:
--
--   • PA012 — linked to an identity outside the application: a driver-app account (`user_id`) or a
--     McLeod, Samsara or EFS id. Those are made for drivers who drive. Deleting one would leave an
--     auth user behind, or be recreated by the next roster sweep.
--   • PA011 — a row in any table that references `drivers(id)` which this function does not own:
--     fuel, HOS, loads, scores, duty sessions, seven-day statements, driver-app invites… Read from
--     `pg_constraint` at call time, NOT from a list. Memory "merge_driver cascade trap": a new table
--     cascading from `drivers` had to be listed in merge_driver by hand or it was silently lost. Here
--     a new table refuses the purge until somebody decides whether an applicant's row in it is the
--     applicant's to lose, which is the safe direction to fail. Also PA011: a DQ export that names the
--     driver (`dq_exports.driver_ids`), which was produced for somebody and is not ours to rewrite.
--
-- ── THE FLAG, AND WHY NOT `merging_driver` ────────────────────────────────────────────────────────
-- A new transaction-local setting, `fuelguard.purging_applicant`, holding the DRIVER'S ID — not 'on'.
--
--   • A new name, because reusing `merging_driver` would make every guard's exemption read "a merge"
--     when it was a purge: the audit trail of WHY a guard let a delete through would be wrong.
--   • The id, not a switch, so the exemption is for ONE applicant's rows. `merging_driver` = 'on'
--     opens the drivers guard for every row; this flag opens each guard only for a row whose driver
--     (or whose invitation's driver) is the one being purged. Another driver's consent, application
--     or signature in the same transaction is still refused.
--   • Set with `set_config(..., true)` — transaction-local — and cleared to '' before the function
--     returns, on merge_driver's reasoning (0235): a caller wrapping several calls in one explicit
--     transaction must not leave the guards open for what follows.
--
-- `purging_applicant(uuid)` and `purging_applicant_invitation(uuid)` are the ONE reading of the flag;
-- every guard calls them. Both coalesce to false: memory "A NULL RLS predicate denies" — a null here
-- would make `if` skip the exemption, which is the safe side, but a guard reading `not (...)` would
-- flip. The comparison is as text so a malformed setting can never raise a cast error in a guard.
--
-- ── THE SIX GUARDS THAT REFUSE A SERVICE-ROLE DELETE ──────────────────────────────────────────────
-- Measured on production 2026-09-28 (pg_trigger × pg_proc, every table in the FK tree below
-- `drivers`): six. Each is reproduced from production's body in full, with ONE branch added — a
-- DELETE of the purged applicant's own row returns — and nothing else changed:
--
--   drivers (DR010), driver_applications (DA010), esign_consents (EC010), signature_adoptions (SA010),
--   employer_verification_calls (EV010), handbook_marks (HB011).
--
-- Not on the list, and why: `application_drafts`, `application_captures`, `application_intakes`,
-- `application_intake_licences`, `drug_test_appointments`, `applicant_travel`, `sms_outbox`,
-- `sms_suppressions` and `application_screen_events` refuse only a JWT-bearing writer
-- (`auth_role() is not null`); the service role already deletes them. `application_packet_marks` and
-- `application_edits` carry no trigger at all (0339 and 0337 rely on having no delete policy). The
-- handoff's note that packet marks "refuse a delete by trigger" was checked and is not so.
--
-- ── WHAT IS DELETED, IN WHAT ORDER ────────────────────────────────────────────────────────────────
-- Explicitly, table by table, so the counts are true and the order satisfies the RESTRICT edges
-- (`signature_adoptions` ← authorizations / packet marks / handbook marks; `employer_inquiries` ←
-- verification calls) and no SET NULL cascade fires an UPDATE guard (driver_applications and
-- driver_authorizations lose `invitation_id` to SET NULL if the invitation goes first — so it goes
-- last). `documents` and `certifications` reference the driver polymorphically (`subject_id`, no FK),
-- so the drivers delete would strand them; they are deleted by subject, after every row that points
-- at a document.
--
-- Left alone ON PURPOSE:
--   • `sms_suppressions` — its `driver_id` is SET NULL by the FK and the row stays. A STOP is about a
--     PHONE NUMBER and must outlive the person, or a new applicant on the same number is texted after
--     saying STOP (TCPA).
--   • `audit_logs` and `notification_events` — append-only history of acts. ⚠ Measured on the two test
--     applicants: `driver.created`, `driver.archived` and `compliance.application_invited` carry the
--     applicant's full name and email in `meta`. So after a purge the NAME survives in the audit
--     trail. That is a question for the owner (§11), not something a purge decides by rewriting an
--     append-only table.
--
-- ── STORAGE IS RETURNED, NOT READ TWICE ───────────────────────────────────────────────────────────
-- SQL cannot remove a Storage object, and once this commits the rows naming the objects are gone.
-- So the function RETURNS every path it removed a row for, keyed by table (the api knows each table's
-- bucket; the schema does not): `documents`, `application_captures`, `signature_adoptions`, and the
-- driver's `photo_path`. The alternative, P2 reading the paths first, races a write landing between
-- the read and the purge (a capture confirmed a second later) and leaves an object nobody can find.
-- P2 removes them after the commit; one it fails to remove is named in the audit row, not retried
-- silently — an orphaned object with no row is findable, a row with no object is not a failure mode
-- this can produce.
--
-- Returns: { "counts": { table: n, … }, "storage": { table: [path, …], … } }.
--
-- cross-module-waiver: an applicant's file spans recruiting's tables, the evidence it filed into
-- (`documents`, `certifications`, `qualification_records`), psp's request rows and roster's
-- `drivers` row. Deleting it has to be one transaction or a refusal half-way leaves a person with
-- no driver row but a filed application; split by module it cannot be.
-- raw-access-waiver: `psp_requests` is read only by `driver_id` to DELETE the purged applicant's
-- own rows (a PSP order for somebody never hired). No psp data is read or returned.

-- ── The one reading of the flag ────────────────────────────────────────────────────────────────
create or replace function public.purging_applicant(p_driver uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('fuelguard.purging_applicant', true) = p_driver::text, false);
$$;

create or replace function public.purging_applicant_invitation(p_invitation uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1 from public.application_invitations i
       where i.id = p_invitation
         and i.driver_id::text = current_setting('fuelguard.purging_applicant', true)
    ),
    false);
$$;

-- ── drivers (0235's body, the purge branch added) ────────────────────────────────────────────
create or replace function public.guard_driver_hard_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('fuelguard.merging_driver', true), 'off') <> 'on'
     and not public.purging_applicant(old.id) then
    raise exception 'drivers are archived (set archived_at), never deleted'
      using errcode = 'DR010';
  end if;
  return old;
end;
$$;

-- ── driver_applications (0220's body, the purge branch added) ───────────────────────────────
create or replace function public.guard_driver_applications_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.purging_applicant(old.driver_id) then
    return old;
  end if;
  raise exception 'driver_applications is append-only: a correction is a new application'
    using errcode = 'DA010';
end;
$$;

-- ── esign_consents (0227's body, the purge branch added) ────────────────────────────────────
create or replace function public.guard_esign_consent_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant(old.driver_id) then
      return old;
    end if;
    raise exception 'esign_consent_immutable' using errcode = 'EC010';
  end if;
  if old.org_id is distinct from new.org_id
     or old.driver_id is distinct from new.driver_id
     or old.invitation_id is distinct from new.invitation_id
     or old.disclosure_version is distinct from new.disclosure_version
     or old.disclosure_text is distinct from new.disclosure_text
     or old.intent_statement is distinct from new.intent_statement
     or old.consented_at is distinct from new.consented_at
     or old.applicant_ip is distinct from new.applicant_ip
     or old.applicant_user_agent is distinct from new.applicant_user_agent
     or (old.withdrawn_at is not null and old.withdrawn_at is distinct from new.withdrawn_at)
  then
    raise exception 'esign_consent_immutable' using errcode = 'EC010';
  end if;
  return new;
end;
$$;

-- ── signature_adoptions (0376's body, the purge branch added) ───────────────────────────────
create or replace function public.guard_signature_adoptions_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant_invitation(old.invitation_id) then
      return old;
    end if;
    raise exception 'signature_adoptions is append-only' using errcode = 'SA010';
  end if;
  if tg_op = 'UPDATE' and (
       old.superseded_by is not null
       or new.superseded_by is null
       or (new.id, new.org_id, new.invitation_id, new.kind, new.typed_text, new.storage_path, new.sha256,
           new.adopted_at, new.adopted_ip, new.adopted_user_agent, new.created_at)
          is distinct from
          (old.id, old.org_id, old.invitation_id, old.kind, old.typed_text, old.storage_path, old.sha256,
           old.adopted_at, old.adopted_ip, old.adopted_user_agent, old.created_at)) then
    raise exception 'signature_adoptions is append-only: only superseded_by may be set, once' using errcode = 'SA010';
  end if;
  if tg_op = 'INSERT' and public.auth_role() is not null then
    raise exception 'signature_adoptions is written only by the application API' using errcode = 'SA010';
  end if;
  return new;
end;
$$;

-- ── employer_verification_calls (0376's body, the purge branch added) ───────────────────────
create or replace function public.guard_employer_verification_calls_append_only()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if public.purging_applicant_invitation(old.invitation_id) then
      return old;
    end if;
    raise exception 'employer_verification_calls is append-only' using errcode = 'EV010';
  end if;
  if tg_op = 'UPDATE' and (
       old.copied_inquiry_id is not null
       or new.copied_inquiry_id is null
       or (new.id, new.org_id, new.invitation_id, new.employer_key, new.employer_name, new.outcomes,
           new.corrections, new.called_by, new.answered_by, new.called_at, new.created_at)
          is distinct from
          (old.id, old.org_id, old.invitation_id, old.employer_key, old.employer_name, old.outcomes,
           old.corrections, old.called_by, old.answered_by, old.called_at, old.created_at)) then
    raise exception 'employer_verification_calls is append-only: only copied_inquiry_id may be set, once' using errcode = 'EV010';
  end if;
  if tg_op = 'INSERT' and public.auth_role() is not null then
    raise exception 'employer_verification_calls is written only by the API' using errcode = 'EV010';
  end if;
  return new;
end;
$$;

-- ── handbook_marks (0374's body, the purge branch added) ────────────────────────────────────
create or replace function public.handbook_marks_guard()
returns trigger
language plpgsql
as $$
declare
  inv record;
begin
  if TG_OP = 'DELETE' and public.purging_applicant_invitation(old.invitation_id) then
    return old;
  end if;
  if TG_OP <> 'INSERT' then
    raise exception 'handbook_marks is append-only' using errcode = 'HB011';
  end if;

  select org_id, expires_at, revoked_at, submitted_at, handbook_signing_opened_at, handbook_filed_at
    into inv
    from application_invitations
   where id = new.invitation_id;

  if not found or inv.org_id <> new.org_id then
    raise exception 'handbook_invitation_not_found' using errcode = 'HB020';
  end if;
  if inv.revoked_at is not null or inv.expires_at <= now() then
    raise exception 'handbook_invitation_unusable' using errcode = 'HB021';
  end if;
  if inv.submitted_at is null then
    raise exception 'handbook_application_not_filed' using errcode = 'HB022';
  end if;
  if inv.handbook_signing_opened_at is null then
    raise exception 'handbook_signing_not_opened' using errcode = 'HB023';
  end if;
  if inv.handbook_filed_at is not null then
    raise exception 'handbook_already_filed' using errcode = 'HB024';
  end if;
  return new;
end;
$$;

-- ── purge_applicant ────────────────────────────────────────────────────────────────────────────
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
  'Q-AW40: deletes an applicant who was never hired, and every row their application wrote, as one audited service-role act (the api writes driver.purged). Refuses PA010 ever hired (status, hire/termination date, or a compliance.applicant_hired audit row), PA011 rows in any drivers-referencing table it does not own or a DQ export naming them, PA012 a driver-app account or McLeod/Samsara/EFS id, PA020 not in this org, PA030 actor not an admin. Opens the six delete guards for THIS driver only, through fuelguard.purging_applicant (transaction-local). Returns {counts, storage}: the Storage paths the api must remove.';

revoke all on function public.purge_applicant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.purge_applicant(uuid, uuid, uuid) to service_role;
