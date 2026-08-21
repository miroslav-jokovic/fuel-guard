-- 0225 — the invitation stops being a fuse and becomes a session (APPLICATION-SYSTEM-PLAN A1, D-APP1).
--
-- ── THE DEFECT THIS FIXES ──────────────────────────────────────────────────────────────────────
-- `ApplyPage.vue` has promised every applicant, since H5b: "If they take it further you will be
-- asked to sign the authorisations you read on this page — each one separately, and each one on its
-- own." The link that made that promise cannot keep it. `resolveInvitation`
-- (apps/api/src/services/applicationIntake.ts) refuses a token whose `used_at` is set; 0220's submit
-- transaction stamps `used_at`; and `POST /:token/release` — the per-instrument signing endpoint —
-- resolves through that same function. So the act of submitting the application closes the door on
-- the signing it promised, and the only path left is a staff member recording the driver's signature
-- through the authenticated route, which is a materially weaker artifact than the driver signing it
-- themselves and is not what the page said would happen.
--
-- Nobody has hit it in production because every instrument in `DISCLOSURES` is `v0-draft` and the
-- signing gate refuses drafts (`applicationIntake.ts` → `disclosure_not_final` → HTTP 409). The bug
-- is latent behind a blocker, and publishing counsel's v1 wording (A0) is what would expose it —
-- which is why this migration lands before that commit can.
--
-- ── WHY PHASE STAMPS AND NOT A SECOND FLAG ─────────────────────────────────────────────────────
-- One boolean cannot express "the four releases are signed, the form is not yet sent". The link is a
-- session with three independently spendable phases, each spent exactly once:
--
--   consented_at           the 15 U.S.C. 7001(c) ESIGN consent that §390.32(d) requires (A4 records it)
--   releases_completed_at  the last of `APPLICATION_RELEASE_ORDER`'s four instruments (A5 stamps it)
--   submitted_at           the certified §391.21(b) application
--
-- Resolution now refuses only what makes the whole credential dead — revoked, expired — and each
-- write path refuses ITS OWN phase being already spent, never somebody else's. The argument is the
-- driver's: someone who signs four releases and then loses signal has given four real signatures, and
-- they must neither be re-solicited nor stranded outside the link that carries them. A0's phase
-- stamps are also what let a resumed session open where it stopped rather than at the beginning,
-- which is the market's one durable finding about these forms (APPLICATION-SYSTEM-PLAN §1): they are
-- long, they are filled on a phone at a truck stop, and the whole battle is not losing the driver
-- mid-form.
--
-- ── `used_at` STAYS, DELIBERATELY, FOR EXACTLY ONE STEP ────────────────────────────────────────
-- It has three readers left, all staff-facing: `INVITE_COLS` in `routes/recruitment/applicationInvites.ts`,
-- that route's `.is("used_at", null)` revoke guard, and the web `inviteState` fold. It keeps being
-- stamped alongside `submitted_at` here so none of them changes behaviour in this migration; A5
-- removes the last reader and drops the column in the same step. Two writers of one fact is a smell,
-- and it is tolerated for precisely that long rather than being spread across a schema change and a
-- UI change in one PR.
--
-- No new table, so no RLS block: `application_invitations` already has RLS on with zero client
-- policies (0220), which is the deny-all-on-purpose posture a table of credentials should have.

alter table public.application_invitations
  add column if not exists consented_at          timestamptz,
  add column if not exists releases_completed_at timestamptz,
  add column if not exists submitted_at          timestamptz;

comment on column public.application_invitations.consented_at is
  'When the applicant gave the 15 U.S.C. 7001(c) electronic-records consent §390.32(d) requires. Set once; every other write path on the link refuses until it is set (A4). The proof itself is the esign_consents row — this is the phase stamp, not the evidence.';
comment on column public.application_invitations.releases_completed_at is
  'When the last of the four APPLICATION_RELEASE_ORDER instruments was signed. Set once; recordRelease refuses after it. The signatures themselves are driver_authorizations rows (0215) — this stamp only says the ceremony is finished.';
comment on column public.application_invitations.submitted_at is
  'When the certified §391.21 application was filed. Set once, inside submit_driver_application, and it is what refuses a second submission. Backfilled from used_at in 0225, which is why an invitation spent before this migration behaves identically after it.';

-- Every invitation spent before this migration was spent by a submission — `used_at` had exactly one
-- writer, the submit transaction. So the backfill is exact rather than an approximation: after it,
-- every existing row answers the phase questions the same way it answered the single-use question.
update public.application_invitations
   set submitted_at = used_at
 where used_at is not null
   and submitted_at is null;

-- ── THE SUBMIT TRANSACTION LEARNS THE DIFFERENCE ───────────────────────────────────────────────
-- `create or replace` in a NEW file is how a function changes here (0089/0096/0154/0203/0222). The
-- body below is 0222's — the live definition, not 0220's — with the invitation checks re-expressed as
-- phases and one column added to the stamp. Nothing else about the transaction is touched: it still
-- files the application, fills the driver's identity, expands the employment list and cites the
-- application as §391.51(b)(1) evidence, all or nothing.
--
-- The refusals split into two named SQLSTATEs where there was one, because they are answers to
-- different questions and the API turns them into different sentences:
--   DA021  the credential is dead (revoked or expired) — the neutral `invalid_link` refusal that
--          tells an anonymous caller nothing about who exists
--   DA022  the credential is live and this phase is spent — "you already sent this", which is safe
--          to say because only the holder of the token can reach it and GET already told them so
-- DA020 (no such invitation, or not this org's, or not this driver's) is unchanged.
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
  p_employment    jsonb
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

  -- Both columns, for one step. `submitted_at` is the fact; `used_at` is the compatibility mirror
  -- three staff-facing readers still fold on, and A5 drops it with its last reader.
  update public.application_invitations
     set submitted_at = now(),
         used_at      = now()
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

comment on function public.submit_driver_application(uuid, uuid, uuid, jsonb, text, text, text, text, text, jsonb, jsonb) is
  'H5/A1: file the certified §391.21 application, spend the invitation''s submit phase, fill the driver identity, expand the employment list and cite the application as §391.51(b)(1) evidence — all or nothing. Refuses an unknown invitation (DA020), a revoked or expired one (DA021) and a second submission on a live link (DA022), leaving the link''s other phases reachable.';
