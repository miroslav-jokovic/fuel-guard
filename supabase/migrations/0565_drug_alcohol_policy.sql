-- 0565 — the page-28 receipt names the drug-and-alcohol policy text the driver was given (DAP1).
--
-- HIRING-WORKFLOW-AUDIT-2026-10-31 §15.2, D-DAP1..D-DAP5 (revised 2026-11-04). Owner on Q-OR7 ("the
-- drug-and-alcohol policy document is not on file"): "analyze and solve this properly", then — with the
-- carrier's 18-page DRUG AND ALCOHOL ABUSE POLICY — "add it properly as document in our system, make sure
-- it follows same design and layout as other documents we have".
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────────────────────────────
-- 49 CFR §382.601(a)-(b): the carrier gives each driver its written policy; (d): each driver signs that he
-- or she RECEIVED A COPY, and the carrier keeps the original. Page 28 of the packet is that receipt (`p28`)
-- but the policy itself was never in the product, so every receipt certified a copy the file cannot show.
--
-- ── WHAT THIS MIGRATION ADDS ────────────────────────────────────────────────────────────────────────
-- The policy is now the HANDBOOK's kind of document: the carrier's text in code
-- (`applicationPdf/drugAlcoholPolicy/drugAlcoholPolicyText.json`), drawn by the handbook's renderer,
-- versioned by a hash of that text (`dap-…`, as `HANDBOOK_VERSION` is `hb-…`). The database only has to
-- remember what the receipt was given against and keep the signed copy:
--
-- 1. `documents.kind` gains `drug_alcohol_policy` — the signed policy filed on the driver with the packet.
-- 2. `application_packet_marks.policy_version` — for `p28` only, the text version the driver read.
-- 3. `record_packet_mark`, a 14-argument overload: 0376's body, plus — for `p28` — a policy version is
--    REQUIRED (DR039), and on every other mark it is refused (DR041). Which version is current is the
--    code's to say (the API stamps the one it serves, as it stamps `packet_version`); SQL checks shape.
--    A SECOND function with no default, as 0376 added its 13-argument one: a defaulted argument beside
--    the 13-argument overload is PGRST203. The 13-argument one stays, so code served before DAP2 signs as
--    it does today during the deploy window; it is dropped once DAP2 is the only caller (§15.2).
--
-- cross-module-waiver: the filed policy is a paper (evidence's `documents` kind) and the receipt that names
-- it is recruiting's packet mark — one act, signing for the policy and filing it, so the kind and its
-- writer land together.
--
-- Rollback: drop function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid, text);
-- alter table public.application_packet_marks drop column policy_version; restore 0534's documents_kind_check.

-- ── 1. documents.kind ─────────────────────────────────────────────────────────────────────────
-- 0534's list, plus the carrier's policy. Nothing removed.
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
  'passport','ssn_card','work_authorization','training_certificate','road_test_certificate',
  'drug_alcohol_policy'));

-- ── 2. which policy text a p28 receipt names ──────────────────────────────────────────────────
alter table public.application_packet_marks
  add column if not exists policy_version text
    check (policy_version is null or policy_version ~ '^dap-[0-9a-f]{16}$');

comment on column public.application_packet_marks.policy_version is
  '§15.2 (D-DAP3): for p28 only, the version (dap-…, a hash of the text) of the carrier''s drug-and-alcohol policy the driver was given when signing the §382.601(d) receipt. Null on every other mark, and on p28 marks made before 0565.';

-- ── 3. record_packet_mark — the 14-argument overload (D-DAP3, D-DAP4) ───────────────────────────
-- 0376's body, plus:
--   DR039  p28 without the policy version the driver was given
--   DR041  a policy version on a mark that receipts none
create or replace function public.record_packet_mark(
  p_org            uuid,
  p_invitation     uuid,
  p_placement      text,
  p_page           int,
  p_mark           text,
  p_anchor         text,
  p_affirmed       text,
  p_signed_name    text,
  p_ip             text,
  p_user_agent     text,
  p_expected_count int,
  p_packet_version text,
  p_adoption_id    uuid,
  p_policy_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_approved  timestamptz;
  v_submitted timestamptz;
  v_opened    timestamptz;
  v_adopted   text;
  v_id        uuid;
  v_signed    int;
begin
  select expires_at, revoked_at, approved_at, submitted_at, signing_opened_at
    into v_expires, v_revoked, v_approved, v_submitted, v_opened
    from public.application_invitations
   where id = p_invitation and org_id = p_org
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'DR030';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'DR031';
  end if;
  if v_approved is null then
    raise exception 'packet_not_yet_approved' using errcode = 'DR032';
  end if;
  if v_submitted is not null then
    raise exception 'packet_already_filed' using errcode = 'DR033';
  end if;
  if v_opened is null then
    raise exception 'packet_not_opened' using errcode = 'DR036';
  end if;

  -- A-5: one packet, one text. A mark made against an earlier version stays what it was; a later mark
  -- against a different text is refused rather than filed beside it. Pre-versioning marks (NULL) are
  -- Q-AW2's question and do not refuse here.
  if exists (select 1 from public.application_packet_marks
              where invitation_id = p_invitation and org_id = p_org
                and packet_version is not null
                and packet_version is distinct from p_packet_version) then
    raise exception 'packet_version_changed' using errcode = 'DR037';
  end if;

  if p_adoption_id is not null and not exists (
       select 1 from public.signature_adoptions
        where id = p_adoption_id and invitation_id = p_invitation and org_id = p_org
          and kind = p_mark and superseded_by is null) then
    raise exception 'adoption_not_found' using errcode = 'DR038';
  end if;

  -- §15.2 (D-DAP3): page 28 is the §382.601(d) receipt, so it names the policy text the driver was given.
  if p_placement = 'p28' then
    if p_policy_version is null then
      raise exception 'drug_alcohol_policy_version_missing' using errcode = 'DR039';
    end if;
  elsif p_policy_version is not null then
    raise exception 'policy_on_a_mark_that_receipts_none' using errcode = 'DR041';
  end if;

  select signed_name into v_adopted
    from public.application_packet_marks
   where invitation_id = p_invitation and org_id = p_org and mark = p_mark
   limit 1;
  if v_adopted is not null and v_adopted <> p_signed_name then
    raise exception 'packet_mark_name_changed' using errcode = 'DR035';
  end if;

  begin
    insert into public.application_packet_marks
      (org_id, invitation_id, placement_id, page, mark, anchor, affirmed,
       signed_name, signed_ip, signed_user_agent, packet_version, adoption_id, policy_version)
    values
      (p_org, p_invitation, p_placement, p_page, p_mark, p_anchor, p_affirmed,
       p_signed_name, p_ip::inet, p_user_agent, p_packet_version, p_adoption_id, p_policy_version)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'packet_mark_already_made' using errcode = 'DR034';
  end;

  select count(*) into v_signed
    from public.application_packet_marks
   where invitation_id = p_invitation and org_id = p_org;

  return jsonb_build_object(
    'mark_id', v_id,
    'signed_count', v_signed,
    'complete', v_signed >= p_expected_count
  );
end;
$$;

revoke all on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid, text)
  to service_role;

comment on function public.record_packet_mark(uuid, uuid, text, int, text, text, text, text, text, text, int, text, uuid, text) is
  '§15.2 (0565): the 13-argument function''s refusals (DR030..DR038) plus DR039 (p28 without a policy version) and DR041 (a policy version on another mark). Records policy_version. The 13-argument overload is dropped once DAP2 is its only caller.';
