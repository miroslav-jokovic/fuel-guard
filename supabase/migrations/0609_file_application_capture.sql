-- 0609 — the office files a photograph that arrived after the application was filed
-- (APPLICATION-FIX-PLAN.md, the documents-only link's stage 3; owner's Q-AM19: "at any time").
--
-- ── WHAT THE GAP IS ───────────────────────────────────────────────────────────────────────────────
-- A staged photograph reaches the driver's file in exactly two places: when Part 1 ends
-- (`complete_applicant_intake`) and when the application is filed (`submit_driver_application`). After
-- that nothing promotes one, so the link refuses photographs once the application is filed — and a
-- medical card that arrives the week after signing can only be uploaded by the office, from a copy the
-- driver had to send some other way.
--
-- ── WHO FILES IT, AND WHY NOT THE LINK ────────────────────────────────────────────────────────────
-- `documents` is evidence: append-only, and in RETENTION_FORBIDDEN. Until filing, a photograph enters
-- it inside an act the driver performs and the carrier reviews. After filing there is no such act, and
-- an unauthenticated link must not write a qualification file by itself. So the link STAGES the
-- photograph, as it always has, and a member of the office files it from the applicant's record:
-- this function, called by the service role for that member, who is named in `audit_logs` by the caller.
--
-- ── THE SHAPE ─────────────────────────────────────────────────────────────────────────────────────
-- `file_application_capture`, one capture at a time. It is 0376's promotion, for one row:
--   · the filed document IS the capture, by id — so a second call inserts nothing and answers the same id;
--   · `uploaded_by` is null, as for every photograph the applicant took: the office FILED it, it did not
--     make it;
--   · `promoted_document_id` is stamped, so the record's list stops showing it as waiting.
-- It refuses (each its own code, so the caller can say which):
--   FC001  no such capture on this invitation, in this org, for this driver
--   FC002  the application is not filed yet — filing itself promotes every staged photograph, and two
--          paths filing the same one is the race this refusal removes
--   FC003  a selfie or a drawn mark — never evidence (D-AW4), whatever the caller passes
-- The kind, the page and the evidence path are the caller's, from the same TypeScript tables the two
-- existing promotions use (`APPLICATION_CAPTURE_DOCUMENT_KIND`, `documentStoragePath`): the vocabulary
-- lives there (0230's division), and the bytes are copied before this is called (copy, then file).
--
-- ── WHY ITS OWN MERGE ─────────────────────────────────────────────────────────────────────────────
-- A function its caller needs: the route that calls it ships in the next merge, so no deployed code
-- ever calls a function the database does not have yet (MIGRATION-DISCIPLINE.md §the-deploy-window).
--
-- cross-module-waiver: recruiting writes `documents`, evidence's table, exactly as 0376's two filing
-- functions do — by the same insert, for the same reason: the row must be written in the transaction
-- that stamps the capture as filed.

create or replace function public.file_application_capture(
  p_org          uuid,
  p_invitation   uuid,
  p_driver       uuid,
  p_capture      uuid,
  p_kind         text,
  p_page         int,
  p_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submitted timestamptz;
  v_found     boolean := false;
  v_capture   record;
begin
  select submitted_at, true into v_submitted, v_found
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  select id, slot, content_type, bytes, sha256, captured_at, promoted_document_id
    into v_capture
    from public.application_captures
   where id = p_capture and invitation_id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if not coalesce(v_found, false) or v_capture.id is null then
    raise exception 'application_capture_not_found' using errcode = 'FC001';
  end if;
  if v_submitted is null then
    raise exception 'application_not_filed' using errcode = 'FC002';
  end if;
  if v_capture.slot in ('selfie', 'signature_mark', 'initials_mark') then
    raise exception 'capture_is_not_evidence' using errcode = 'FC003';
  end if;
  if v_capture.promoted_document_id is not null then
    return v_capture.promoted_document_id;
  end if;

  insert into public.documents
    (id, org_id, subject_type, subject_id, kind, storage_path, content_type, bytes, sha256, page,
     captured_at, uploaded_by)
  values
    (v_capture.id, p_org, 'driver', p_driver, p_kind, p_storage_path, v_capture.content_type,
     v_capture.bytes, v_capture.sha256, p_page, v_capture.captured_at, null::uuid)
  on conflict (id) do nothing;

  update public.application_captures
     set promoted_document_id = v_capture.id
   where id = v_capture.id;

  return v_capture.id;
end;
$$;

revoke all on function public.file_application_capture(uuid, uuid, uuid, uuid, text, int, text) from public, anon, authenticated;
grant execute on function public.file_application_capture(uuid, uuid, uuid, uuid, text, int, text) to service_role;

comment on function public.file_application_capture(uuid, uuid, uuid, uuid, text, int, text) is
  'Q-AM19 stage 3 (0609): the office files ONE staged photograph that arrived after the application was filed. The document is the capture by id (idempotent), uploaded_by null as for every applicant photograph, promoted_document_id stamped. Refuses FC001 not this invitation''s capture, FC002 application not filed yet (filing promotes it), FC003 a selfie or a drawn mark.';
