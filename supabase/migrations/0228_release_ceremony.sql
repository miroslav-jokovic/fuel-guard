-- 0228 — the signing ceremony's transaction (APPLICATION-SYSTEM-PLAN A5, D-APP7).
--
-- `POST /api/public/application/:token/release` has existed since H5b and has never had a caller.
-- A5 gives it one: the driver adopts a signature once and then affirms each of the four instruments
-- in `APPLICATION_RELEASE_ORDER` on its own screen, with its own text and its own control. This is
-- the database half of that.
--
-- ── WHY A SIGNATURE NOW NAMES THE LINK IT WAS GIVEN THROUGH ────────────────────────────────────
-- `driver_authorizations` (0215) records WHO signed WHAT and when, and until now nothing recorded
-- through which act. For a staff-recorded wet signature that is fine — `recorded_by` names the
-- person who keyed it in. For an unauthenticated e-signature it is the missing half of the
-- provenance: the invitation is what authenticated the signer, so the row should say which one.
--
-- It also makes the ceremony's completeness a fact rather than a guess. "Has this driver signed the
-- four?" is not the question — a rehire may have signed the same purposes a year ago, on a different
-- application, and those signatures do not discharge this one (⚠ PSP's account agreement requires a
-- signed authorization in advance of EACH request; APPLICATION-SYSTEM-PLAN §4). The question is
-- whether THIS session collected them, and without `invitation_id` it cannot be asked.
--
-- Nullable, because the column describes a path and not every signature takes it: staff-recorded
-- signatures have no invitation, and every row written before today has none either.
alter table public.driver_authorizations
  add column if not exists invitation_id uuid references public.application_invitations(id) on delete set null;

comment on column public.driver_authorizations.invitation_id is
  'The application link this signature was given through, when the driver signed it themselves (A5). Null for staff-recorded signatures and for everything written before 0228. `on delete set null`: an invitation is a credential and may be cleaned up, but the signature it produced is evidence and never goes with it.';

-- One signature per instrument per link. The done-when A5 is measured by — "no single control in the
-- UI can produce more than one of them" — expressed where a double-tap, a replayed request and a
-- second browser tab all meet it. It does NOT constrain the same purpose signed through a different
-- invitation, which is a legitimate re-screen.
create unique index if not exists uq_driver_authorizations_invitation_purpose
  on public.driver_authorizations (invitation_id, purpose)
  where invitation_id is not null and revokes is null;

-- ── RECORDING ONE SIGNATURE, AND CLOSING THE CEREMONY ON THE LAST ──────────────────────────────
-- The row and the phase stamp are the same fact written twice, so they are one transaction — 0225's
-- rule and 0227's. A signature filed without the stamp would leave the ceremony asking for an
-- instrument that is already signed; a stamp without the row would close a ceremony that never
-- happened.
--
-- ⚠ `p_expected_count` is the length of `APPLICATION_RELEASE_ORDER`, passed in rather than hardcoded.
-- The vocabulary lives in TypeScript (`packages/shared`) and this applies what it produced — the same
-- division 0218 and 0220 draw, and the reason a fifth instrument one day is a change to one array
-- rather than to a migration nobody remembers to write.
create or replace function public.record_driver_release(
  p_org            uuid,
  p_invitation     uuid,
  p_driver         uuid,
  p_purpose        text,
  p_version        text,
  p_text           text,
  p_intent         text,
  p_signed_name    text,
  p_ip             text,
  p_user_agent     text,
  p_expected_count int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_completed timestamptz;
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_consented timestamptz;
  v_id        uuid;
  v_signed    int;
begin
  -- FOR UPDATE: "the fourth one closes the ceremony" is only true if the count and the stamp cannot
  -- interleave with another signature.
  select releases_completed_at, expires_at, revoked_at, consented_at
    into v_completed, v_expires, v_revoked, v_consented
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'DR020';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'DR021';
  end if;
  if v_completed is not null then
    raise exception 'releases_already_complete' using errcode = 'DR022';
  end if;

  begin
    insert into public.driver_authorizations
      (org_id, driver_id, invitation_id, purpose, disclosure_version, disclosure_text,
       method, signed_name, intent_statement, esign_consent_at, accepted_ip, accepted_user_agent,
       -- No `recorded_by`: nobody in the carrier recorded this. The applicant signed it themselves,
       -- and a staff id here would misattribute the act to whoever sent the link.
       recorded_by)
    values
      (p_org, p_driver, p_invitation, p_purpose, p_version, p_text,
       'esign', p_signed_name, p_intent, now(), p_ip::inet, p_user_agent,
       null)
    returning id into v_id;
  exception when unique_violation then
    -- The same instrument, twice, on the same link: a double-tap or a second tab. Named, so the API
    -- can tell the driver they have already signed this one instead of failing opaquely.
    raise exception 'release_already_signed' using errcode = 'DR023';
  end;

  select count(*) into v_signed
    from public.driver_authorizations
   where invitation_id = p_invitation and org_id = p_org and revokes is null;

  if v_signed >= p_expected_count then
    update public.application_invitations
       set releases_completed_at = now()
     where id = p_invitation and org_id = p_org;
    v_completed := now();
  end if;

  return jsonb_build_object(
    'authorization_id', v_id,
    'signed_count', v_signed,
    'completed', v_completed is not null
  );
end;
$$;

revoke all on function public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int) to service_role;

comment on function public.record_driver_release(uuid, uuid, uuid, text, text, text, text, text, text, text, int) is
  'A5: file one signed instrument against the link that carried it, and stamp releases_completed_at when the last of them lands — both or neither. Refuses an unknown invitation (DR020), a revoked or expired one (DR021), a ceremony already closed (DR022) and the same instrument signed twice on one link (DR023).';
