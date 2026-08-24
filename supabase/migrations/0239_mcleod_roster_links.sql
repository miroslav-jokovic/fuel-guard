-- 0239: the link columns that let McLeod own the roster (MCLEOD-ROSTER-SYNC-PLAN M2, D-MR10/D-MR11)
--
-- Silvicom runs LoadMaster as their system of record for who is employed and what is in the fleet.
-- FuelGuard has been learning that from Samsara, which knows who is *driving* — a related question,
-- not the same one. Measured against the carrier's database on 2026-08-24, the two answers already
-- disagree: ten vehicles this product calls `active` were taken out of service in McLeod between
-- 2021-08-09 and 2026-06-25, one of them four years ago, and seven drivers we hold as active are
-- absent from all 1,457 licence numbers McLeod has ever recorded.
--
-- This migration only adds the LINK. No sync writes through it yet (M3 is link-only, M4 turns on
-- field writes); shipping the columns first means the match can be measured against production data
-- before anything depends on it.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY A LINK COLUMN AND NOT A ROSTER SWAP
--
-- `samsara_driver_id` and `samsara_vehicle_id` are not identity fields, they are JOIN KEYS —
-- hosSync.ts alone dereferences the driver one in seventeen places, and idleSync, idleRollup,
-- idleDutyEvidenceSync, driverScoreSync and efsImport/reconcile all follow it. A driver row created
-- from McLeod with a null Samsara link has no hours, no idle evidence and no score, and nothing
-- anywhere raises. So the two systems keep separate columns and separate jobs: McLeod answers "is
-- this person on the roster", Samsara answers "what did they do", and the row carries both keys.
--
-- The measured roster overlap says that split will hold. Matching on licence number, 162 of McLeod's
-- 164 active drivers already correspond to an active FuelGuard driver (98.8%); vehicles match 175 of
-- 190 on VIN and on unit number independently, both selecting the same 175.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- WHY `mcleod_company_id` IS A COLUMN AND NOT A CONSTANT
--
-- `dbo.company` holds four rows and every one of them has `company_id = 'TMS'` — that column is the
-- LoadMaster instance code, not a tenant key. The discriminator is `company.id`, and the master
-- tables reference that: TMS = Silvicom Inc (DOT 1864495, the carrier), TMS2 = Silvicom Logistics
-- (27 drivers, none active), TMS3 = JVM Freight Group (empty), TMS4 = VIP Equipment Holding (one row
-- of each). Storing which one a row came from is what lets TMS2 become a second FuelGuard org later
-- without a backfill, and it makes a mis-scoped extract visible in the data instead of silent.

alter table drivers  add column if not exists mcleod_driver_id  text;
alter table drivers  add column if not exists mcleod_company_id text;
alter table vehicles add column if not exists mcleod_tractor_id text;
alter table vehicles add column if not exists mcleod_company_id text;
alter table trailers add column if not exists mcleod_trailer_id text;
alter table trailers add column if not exists mcleod_company_id text;

comment on column drivers.mcleod_driver_id is
  'dbo.driver.id in the carrier''s LoadMaster (char(8), trimmed). The roster link; NOT the telematics
   link — samsara_driver_id stays the join key for hours, idle and scores.';
comment on column drivers.mcleod_company_id is
  'Which LoadMaster legal entity this row came from — dbo.company.id (TMS/TMS2/...), NOT dbo.company.company_id,
   which is the instance code and is ''TMS'' on all four rows.';
comment on column vehicles.mcleod_tractor_id is 'dbo.tractor.id in the carrier''s LoadMaster (char(8), trimmed).';
comment on column trailers.mcleod_trailer_id is 'dbo.trailer.id in the carrier''s LoadMaster (char(8), trimmed).';

-- One FuelGuard row per McLeod record per org — the same partial-unique shape 0123 used to make the
-- 2026-08 fleet duplication structurally impossible. Partial, so the overwhelming majority of rows
-- (everything not yet linked) stay NULL and unconstrained; a second row claiming the same McLeod id
-- now fails loudly instead of quietly doubling the roster.
--
-- ⚠ These will REFUSE to build over existing duplicates, deliberately. That cannot happen on a fresh
-- column, but it can on a re-run after a partially applied sync, which is why the ingest keys on
-- (org_id, mcleod_*_id) and never blind-inserts.
create unique index if not exists uq_drivers_org_mcleod
  on drivers  (org_id, mcleod_driver_id)  where mcleod_driver_id  is not null;
create unique index if not exists uq_vehicles_org_mcleod
  on vehicles (org_id, mcleod_tractor_id) where mcleod_tractor_id is not null;
create unique index if not exists uq_trailers_org_mcleod
  on trailers (org_id, mcleod_trailer_id) where mcleod_trailer_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- PROVENANCE
--
-- 0098 admitted 'samsara' and 'manual'; 0204 added 'efs' after finding that 81 of 248 "active"
-- drivers were fuel-card stubs claiming telematics provenance. A McLeod-sourced row is a fourth
-- thing again — an employment record from the carrier's own system — and it has to be distinguishable
-- because D-MR6 gives it different write rules: unlike a telematics row, its licence and medical dates
-- are authoritative and refreshed every sweep rather than written once when empty.
--
-- The existing escape hatch is unchanged and is the reason that is safe: an office edit to an identity
-- field claims the row to 'manual' (resolveDriverUpdate), after which no sync writes it again.
alter table drivers  drop constraint if exists drivers_identity_source_check;
alter table drivers  add constraint drivers_identity_source_check
  check (identity_source in ('samsara', 'manual', 'efs', 'mcleod'));

alter table vehicles drop constraint if exists vehicles_identity_source_check;
alter table vehicles add constraint vehicles_identity_source_check
  check (identity_source in ('samsara', 'manual', 'mcleod'));

alter table trailers drop constraint if exists trailers_identity_source_check;
alter table trailers add constraint trailers_identity_source_check
  check (identity_source in ('samsara', 'manual', 'mcleod'));

comment on column drivers.identity_source is
  'Provenance: ''samsara'' (telematics sync), ''manual'' (office-created or office-claimed), ''efs''
   (auto-provisioned from a fuel-card name — a payment identity, not necessarily an employee),
   ''mcleod'' (the carrier''s TMS employment record). EFS rows are excluded from qualification surfaces
   and from SambaSafety enrollment.';

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- merge_driver HAS TO LEARN THE NEW COLUMN
--
-- Nothing enforces this. No lint gate reads merge_driver, and the function has now been left stale
-- twice — 0203 for qualification_records and documents, 0234 for nine recruiting tables that shipped
-- after it.
--
-- ⚠ THIS MIGRATION'S FIRST DRAFT WAS THE THIRD TIME. It was written by copying the function body out
-- of 0203, which is the newest migration whose TITLE is about merge_driver — and four later ones had
-- amended it since: 0234 (recruiting reassignments), 0235 (the hard-delete guard exemption), 0236
-- (seven_day_statements) and 0238 (the MD010 refusal and applicant_dispositions). `create or replace`
-- reverted all four silently. The behavioural matrix caught it on the first run, as
-- `merge_driver completes when only the duplicate carries a McLeod link` failed with DR010 — 0235's
-- guard refusing a delete that the reverted body no longer announced. The lesson for whoever amends
-- this function next: `grep -l 'function public.merge_driver' supabase/migrations/*.sql | sort | tail -1`
-- is the body to start from, and it is very unlikely to be the migration named after it.
--
-- The failure mode this migration is fixing is specific: `uq_drivers_org_mcleod` is a partial unique index, so
-- folding a duplicate that carries a McLeod id into a canonical row that does not would try to write
-- that id onto the canonical while the source still holds it — a unique violation that aborts the
-- merge mid-way. 0203 solved exactly this for efs_driver_id by clearing the source FIRST, and the
-- same two statements are what this needs.
--
-- Only the id is coalesced. `mcleod_company_id` rides along with it, because a link without the entity
-- it came from cannot be re-resolved against the right LoadMaster company.
--
-- ⚠ KNOWN GAP, deliberately NOT fixed here: merge_driver has never carried `samsara_driver_id` either.
-- A merge where only the SOURCE holds the telematics link loses it, and the canonical driver silently
-- stops receiving hours and idle evidence. That predates this migration and is out of M2's scope, but
-- it gets more likely once EFS stubs are reconciled against a real roster (plan §9), so it needs its
-- own decision rather than a quiet fix folded into a schema change.
create or replace function public.merge_driver(p_org uuid, p_source uuid, p_canonical uuid)
returns void
language plpgsql
as $$
declare
  v_efs text;
  v_phone text;
  v_emp text;
  v_mcleod text;
  v_mcleod_co text;
begin
  if p_source is null or p_canonical is null or p_source = p_canonical then
    return;
  end if;
  if not exists (select 1 from public.drivers where id = p_source and org_id = p_org)
     or not exists (select 1 from public.drivers where id = p_canonical and org_id = p_org) then
    raise exception 'merge_driver: source % or canonical % not found in org %', p_source, p_canonical, p_org;
  end if;

  -- ── REFUSE RATHER THAN DESTROY ───────────────────────────────────────────────────────────────
  -- Three tables cannot follow the driver: `driver_applications` and `esign_consents` refuse UPDATE
  -- and DELETE outright (DA010/EC010), and `sms_consents` guards `driver_id` itself (SC010) while its
  -- trigger covers UPDATE only — so a cascade would take it silently. Checked BEFORE the first write,
  -- so the operator gets one sentence about the driver they named instead of a trigger's error about
  -- a table they did not.
  if exists (select 1 from public.driver_applications where driver_id = p_source and org_id = p_org)
     or exists (select 1 from public.esign_consents where driver_id = p_source and org_id = p_org)
     or exists (select 1 from public.sms_consents where driver_id = p_source and org_id = p_org)
  then
    raise exception
      'merge_driver: driver % has signed evidence that cannot be moved (a certified application, an e-sign consent or an SMS consent). Archive the duplicate instead of merging it.',
      p_source
      using errcode = 'MD010';
  end if;

  select efs_driver_id, phone, employee_id, mcleod_driver_id, mcleod_company_id
    into v_efs, v_phone, v_emp, v_mcleod, v_mcleod_co
    from public.drivers where id = p_source;
  -- Clear the source's unique-indexed links BEFORE claiming them, or the canonical update collides
  -- with the row it is about to absorb (uq_drivers_org_efs, uq_drivers_org_mcleod).
  update public.drivers set efs_driver_id = null, mcleod_driver_id = null where id = p_source;
  update public.drivers
     set efs_driver_id = coalesce(efs_driver_id, v_efs),
         phone = coalesce(phone, v_phone),
         employee_id = coalesce(employee_id, v_emp),
         mcleod_driver_id = coalesce(mcleod_driver_id, v_mcleod),
         mcleod_company_id = coalesce(mcleod_company_id, v_mcleod_co)
   where id = p_canonical and org_id = p_org;

  update public.fuel_transactions set driver_id = p_canonical where driver_id = p_source;
  update public.fuel_cards set driver_id = p_canonical where driver_id = p_source;
  update public.declined_transactions set driver_id = p_canonical where driver_id = p_source;
  update public.idle_events set driver_id = p_canonical where driver_id = p_source;
  update public.hos_duty_segments set driver_id = p_canonical where driver_id = p_source;
  update public.driver_time_off set driver_id = p_canonical where driver_id = p_source;
  update public.loads set driver_id = p_canonical where driver_id = p_source;
  update public.load_stop_photos set driver_id = p_canonical where driver_id = p_source;
  update public.hazmat_loads set driver_id = p_canonical where driver_id = p_source;
  update public.invites set driver_id = p_canonical where driver_id = p_source;
  update public.vehicles set assigned_driver_id = p_canonical where assigned_driver_id = p_source;
  update public.vehicles set owner_driver_id = p_canonical where owner_driver_id = p_source;

  delete from public.driver_scores s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_scores c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_scores set driver_id = p_canonical where driver_id = p_source;

  delete from public.driver_performance_weeks s
   where s.driver_id = p_source
     and exists (select 1 from public.driver_performance_weeks c
                  where c.driver_id = p_canonical and c.org_id = s.org_id and c.week_start = s.week_start);
  update public.driver_performance_weeks set driver_id = p_canonical where driver_id = p_source;

  -- Certifications are temporal and append-only. When both drivers have a current row for the same
  -- kind/qualifier, preserve the source row as superseded history before moving it to the canonical id.
  update public.certifications s
     set superseded_by = c.id,
         superseded_at = coalesce(s.superseded_at, now()),
         updated_at = now()
    from public.certifications c
   where s.org_id = p_org
     and s.subject_type = 'driver'
     and s.subject_id = p_source
     and s.superseded_by is null
     and c.org_id = p_org
     and c.subject_type = 'driver'
     and c.subject_id = p_canonical
     and c.superseded_by is null
     and c.kind = s.kind
     and coalesce(c.qualifier, '') = coalesce(s.qualifier, '');
  update public.certifications
     set subject_id = p_canonical,
         updated_at = now()
   where org_id = p_org and subject_type = 'driver' and subject_id = p_source;

  -- ── RECRUITING EVIDENCE FOLLOWS THE DRIVER (0234) ────────────────────────────────────────────
  -- Every table added after 0203 that references drivers(id) on delete cascade and CAN be reassigned.
  -- Append-only stores with no per-driver uniqueness, so a plain move is safe and the merged history
  -- reads as one driver's, which is the premise of the merge.
  update public.driver_employment_history set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  -- `employer_inquiries.employment_id` points at a driver_employment_history ROW ID, which a
  -- reassignment does not change, so these two need no ordering between them.
  update public.employer_inquiries set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.driver_authorizations set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.psp_requests set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.application_invitations set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.application_drafts set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.application_captures set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  -- 0236. ⚠ The lesson from 0234, applied on the day the table is created rather than two years
  -- later: a new table referencing drivers(id) on delete cascade that merge_driver does not know
  -- about is destroyed by the next roster dedup, and nothing in the gate set connects the two.
  update public.seven_day_statements set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  -- 0238. ⚠ **MD010 does not cover this one, and that is the whole reason it is here.** The
  -- return-to-duty flag (0237) needed no merge work because it can only exist on a driver who has a
  -- `driver_applications` row, and MD010 already refuses to merge one of those away. A DISPOSITION
  -- has no such protection: an applicant can be declined before they ever open the link, so a
  -- declined lead with no application is exactly the row a roster dedup would cascade into nothing.
  update public.applicant_dispositions set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;

  -- §391.51 events and filed scans go with the driver. Append-only, no per-driver uniqueness, so the
  -- merged history reads exactly as if it had always been one driver. Without these two statements
  -- the drivers delete below cascades qualification_records away and strands documents on a dead id.
  update public.qualification_records
     set driver_id = p_canonical
   where org_id = p_org and driver_id = p_source;
  update public.documents
     set subject_id = p_canonical
   where org_id = p_org and subject_type = 'driver' and subject_id = p_source;

  delete from public.driver_duty_sessions s
   where s.driver_id = p_source and s.ended_at is null
     and exists (select 1 from public.driver_duty_sessions c
                  where c.driver_id = p_canonical and c.ended_at is null);
  update public.driver_duty_sessions set driver_id = p_canonical where driver_id = p_source;

  -- ── THE ONE DELETE THE 0235 GUARD LETS THROUGH ───────────────────────────────────────────────
  -- `guard_driver_hard_delete` (0235) refuses every DELETE on `drivers`, service role included. This
  -- function is the sole legitimate caller, and by the time control reaches this line it has EARNED
  -- the exemption: every reassignable table has been moved off the source above, and the three that
  -- cannot move refused the merge before the first write. The row being deleted holds nothing.
  --
  -- The flag is transaction-LOCAL (`set_config(..., true)`), so it cannot outlive the statement that
  -- set it — a supabase-js `rpc()` is one statement in one transaction. It is cleared immediately
  -- afterwards anyway, so that a caller who wraps several merges in one explicit transaction does not
  -- leave the guard disabled for whatever follows them.
  perform set_config('fuelguard.merging_driver', 'on', true);
  delete from public.drivers where id = p_source and org_id = p_org;
  perform set_config('fuelguard.merging_driver', 'off', true);
end;
$$;

comment on function public.merge_driver(uuid, uuid, uuid) is
  'Atomically folds a duplicate driver into the canonical driver. Temporal certifications are collision-safe; qualification_records and driver documents are reassigned (0203) so a merge never destroys or strands §391.51 evidence; the EFS and McLeod links are cleared on the source before being claimed (0239) so the partial unique indexes cannot abort the merge.';
