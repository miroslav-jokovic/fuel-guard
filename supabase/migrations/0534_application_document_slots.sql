-- 0534 — every document an applicant may have, as a photo or a PDF, and several of the ones that come
-- in several (HIRING-WORKFLOW-AUDIT-2026-10-31 §9 P6, §3.5, §4.7). The reader is §9 P9.
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- The audit measured why the owner sees "only the CDL": the applicant link offers CDL front/back,
-- the medical card, the SSN card and a selfie, and nothing else (`application_captures_slot_check`,
-- 0376). A TWIC, a passport, a green card or work permit, a hazmat endorsement, a previous road-test
-- certificate, training certificates — none can be sent. Images only, so a driver with a PDF medical
-- certificate cannot send it. And ONE row per slot (0230's `unique (invitation_id, slot)`), so two
-- training certificates cannot coexist. On the office side, `documents.kind` has no `passport`,
-- `ssn_card`, `work_authorization`, `training_certificate` or `road_test_certificate`, so a capture
-- of one would have nowhere to be filed.
--
-- ── WHAT THIS DOES ─────────────────────────────────────────────────────────────────────────────
--   1. `application_captures.slot` gains `twic`, `passport`, `work_authorization`,
--      `hazmat_endorsement`, `road_test_certificate`, `training_certificate`.
--   2. `application_captures.content_type` gains `application/pdf` — for every slot except the
--      three that are pictures by nature (the selfie and the two adopted marks).
--   3. `application_captures.ordinal` (default 0) and the one-row rule becomes one row per
--      (slot, ordinal). Ordinals 0–4 for the slots that come in several (`training_certificate`,
--      `road_test_certificate`, `other`) — a limit of five, in the CHECK, so a link cannot be used as
--      free storage — and 0 only for every other slot, which keeps "a re-shoot replaces" (D-APP10)
--      exactly as it was for the CDL, the medical card and the rest.
--   4. `stage_application_capture` gains a 10-argument overload with `p_ordinal`, which replaces only
--      that (slot, ordinal). The 9-argument one is UNCHANGED — it still replaces the whole slot — so
--      the API served before P9 keeps working on either side of this migration.
--   5. `documents.kind` gains `passport`, `ssn_card`, `work_authorization`, `training_certificate`,
--      `road_test_certificate` (and `DOCUMENT_KINDS` in `complianceContract.ts`, which the
--      `unit-file-kinds` and `roadside-documents` matrices hold equal to this CHECK).
--
-- ── WHAT WAS REJECTED ──────────────────────────────────────────────────────────────────────────
-- · Dropping the one-row rule altogether: a re-shot CDL must still replace the first photo, or the
--   office files two fronts. The ordinal keeps the rule for every single-document slot.
-- · A separate `application_capture_files` table for the multi-document slots: two places for one
--   kind of thing, and two promotion paths into `documents`. One table, one more column.
-- · Who may SEE an SSN-card or passport image (Q-WF4) is not schema: `documents` has no client
--   policies for those reads; the API's document reader gates it (P9).
--
-- ⚠ DEPLOY WINDOW: every change widens what is accepted. Old code writes ordinal 0 through the
-- unchanged 9-argument function and never names a new slot or kind; new code (P9) is merged after.
-- Production shape: the unique constraint is named `application_captures_invitation_id_slot_key` in
-- `schema.generated.sql`; dropped by name, `if exists`, and a second `if exists` sweep below catches
-- any other unique constraint on exactly (invitation_id, slot) that a drifted catalog might carry.

-- ── 1–3. application_captures ────────────────────────────────────────────────────────────────
alter table public.application_captures
  add column if not exists ordinal smallint not null default 0;

alter table public.application_captures drop constraint if exists application_captures_invitation_id_slot_key;
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.application_captures'::regclass
       and c.contype = 'u'
       and (select array_agg(a.attname order by a.attname)
              from pg_attribute a
             where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) = array['invitation_id', 'slot']::name[]
  loop
    execute format('alter table public.application_captures drop constraint %I', v_name);
  end loop;
end;
$$;
alter table public.application_captures drop constraint if exists application_captures_invitation_slot_ordinal_key;
alter table public.application_captures
  add constraint application_captures_invitation_slot_ordinal_key unique (invitation_id, slot, ordinal);

alter table public.application_captures drop constraint if exists application_captures_slot_check;
alter table public.application_captures add constraint application_captures_slot_check
  check (slot in (
    'cdl_front','cdl_back','medical_card','ssn_card','signature_mark','initials_mark','selfie','other',
    'twic','passport','work_authorization','hazmat_endorsement','road_test_certificate',
    'training_certificate'));

alter table public.application_captures drop constraint if exists application_captures_ordinal_check;
alter table public.application_captures add constraint application_captures_ordinal_check
  check (
    ordinal = 0
    or (slot in ('training_certificate', 'road_test_certificate', 'other') and ordinal between 1 and 4)
  );

alter table public.application_captures drop constraint if exists application_captures_content_type_check;
alter table public.application_captures add constraint application_captures_content_type_check
  check (
    content_type in ('image/jpeg', 'image/png', 'image/webp')
    or (content_type = 'application/pdf' and slot not in ('selfie', 'signature_mark', 'initials_mark'))
  );

comment on column public.application_captures.ordinal is
  '§9 P6 (0534): which of several documents in one slot — 0 for every single-document slot, 0–4 for training_certificate, road_test_certificate and other. A re-shoot replaces the same (slot, ordinal).';

-- ── 4. stage_application_capture, by ordinal ──────────────────────────────────────────────────
-- 0230's body with the slot narrowed to (slot, ordinal). Same race handling: two confirms for the
-- same place both delete and both insert, the loser retries once, and the later photograph wins.
create or replace function public.stage_application_capture(
  p_org          uuid,
  p_invitation   uuid,
  p_driver       uuid,
  p_capture      uuid,
  p_slot         text,
  p_path         text,
  p_content_type text,
  p_bytes        bigint,
  p_sha256       text,
  p_ordinal      smallint
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
   where invitation_id = p_invitation and org_id = p_org and slot = p_slot and ordinal = p_ordinal
   returning storage_path into v_replaced;

  begin
    insert into public.application_captures
      (id, org_id, invitation_id, driver_id, slot, ordinal, storage_path, content_type, bytes, sha256)
    values
      (p_capture, p_org, p_invitation, p_driver, p_slot, p_ordinal, p_path, p_content_type, p_bytes, p_sha256)
    returning captured_at into v_captured;
  exception when unique_violation then
    delete from public.application_captures
     where invitation_id = p_invitation and org_id = p_org and slot = p_slot and ordinal = p_ordinal
     returning storage_path into v_replaced;
    insert into public.application_captures
      (id, org_id, invitation_id, driver_id, slot, ordinal, storage_path, content_type, bytes, sha256)
    values
      (p_capture, p_org, p_invitation, p_driver, p_slot, p_ordinal, p_path, p_content_type, p_bytes, p_sha256)
    returning captured_at into v_captured;
  end;

  return jsonb_build_object('capture_id', p_capture, 'captured_at', v_captured, 'replaced_path', v_replaced);
end;
$$;

revoke all on function public.stage_application_capture(uuid, uuid, uuid, uuid, text, text, text, bigint, text, smallint)
  from public, anon, authenticated;
grant execute on function public.stage_application_capture(uuid, uuid, uuid, uuid, text, text, text, bigint, text, smallint)
  to service_role;

comment on function public.stage_application_capture(uuid, uuid, uuid, uuid, text, text, text, bigint, text, smallint) is
  '§9 P6 (0534): stage one applicant capture at (slot, ordinal), replacing only that place. Returns capture_id, captured_at and replaced_path (the superseded object, for the caller to remove). The 9-argument overload still replaces the whole slot.';

-- ── 5. documents.kind ─────────────────────────────────────────────────────────────────────────
-- 0530's list, plus the five. Nothing removed.
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check check (kind in (
  'cdl','medical_card','endorsement','hazmat_training','twic',
  'registration','annual_inspection','insurance','ifta','irp',
  'lease','permit',
  'phmsa_registration','hazmat_safety_permit','security_plan',
  'financial_responsibility','operating_authority',
  'employment_application','mvr','annual_mvr_review','road_test',
  'cdl_equivalency','previous_employer_inquiry','previous_employer_response',
  'clearinghouse_full','clearinghouse_limited','eldt','spe_certificate',
  'medical_registry_verification','drug_test','alcohol_test','accident',
  'psp_report','return_to_duty',
  'orientation','handbook',
  'clearinghouse_portal_consent',
  'title',
  'other',
  'roadside_inspection_report','citation','court_disposition',
  'dataqs_packet','dataqs_correspondence',
  'roadside_repair_record',
  'equipment_invoice',
  'passport','ssn_card','work_authorization','training_certificate','road_test_certificate'));
