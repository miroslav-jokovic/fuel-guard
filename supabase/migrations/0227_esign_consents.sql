-- 0227 — proof that the driver agreed to do this electronically (APPLICATION-SYSTEM-PLAN A4, D-APP5).
--
-- ── WHY THIS TABLE EXISTS AT ALL ───────────────────────────────────────────────────────────────
-- 49 CFR §390.32(b) lets an electronic method satisfy any document requirement in Parts 300–399,
-- which includes §391.21's application. §390.32(d) then says what such a record must be: it must
-- accurately reflect the required content, be retainable, be accurately reproducible, and **include
-- proof of consent per 15 U.S.C. 7001(c)**.
--
-- That last clause is the one nothing in this product satisfied. We have the application, the
-- signatures, the IP, the user agent and the exact text — and no record that the driver ever agreed
-- to receive and sign any of it on a screen rather than on paper. Without it the electronic
-- application is not, in FMCSA's terms, the document §391.21 asked for.
--
-- ── AND WHY IT IS A TABLE, NOT A BOOLEAN ON THE INVITATION ─────────────────────────────────────
-- 7001(c) is not a checkbox. Read verbatim on 2026-08-21, it enumerates SIX things the consumer must
-- be told before consenting: the right to have the record on paper (c)(1)(B)(i)(I), the right to
-- withdraw and what withdrawal costs them (c)(1)(B)(i)(II), whether the consent covers this
-- transaction or categories of records (c)(1)(B)(ii), how to withdraw and how to update their contact
-- details (c)(1)(B)(iii), how to get a paper copy afterwards and any fee (c)(1)(B)(iv), and a
-- statement of the hardware and software needed to read and keep the records (c)(1)(C)(i).
--
-- A consent is therefore a signed instrument exactly like the five in `DISCLOSURES`, and the thing
-- that makes any signature worth anything is that the exact text is stored beside it — the pattern
-- 0092 set for `hazmat_reviews.attestation` and 0215 repeated for `driver_authorizations`. A boolean
-- would record that somebody clicked something, which is not what the regulation asks us to be able
-- to produce.
--
-- ── EVIDENCE SIDE OF THE LINE, AND THE TRIGGER STYLE THAT SAYS SO ──────────────────────────────
-- The EI010/DA010 family: the guard fires for EVERY writer, the service role included. 0226's
-- `application_drafts` took 0213's style for the opposite reason (a draft must be prunable, and A11's
-- retention rule runs as the service role) — this is the other side of that argument. Nothing may
-- rewrite proof of consent, ever, and there is no operational need that could justify it: a
-- correction is a new consent, and a withdrawal is `withdrawn_at`, which is a fact ABOUT the consent
-- rather than an edit OF it.
--
-- The table joins `RETENTION_FORBIDDEN` (`apps/api/src/services/dataRetention.ts`) in the same PR, for
-- the reason the qualification file is on that list: §390.32(d) asks the record to be reproducible
-- when somebody asks, years later, and a consent that can be aged out is a consent that cannot answer
-- the question it exists to answer.
create table if not exists public.esign_consents (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  driver_id            uuid not null references public.drivers(id) on delete cascade,
  -- Which link it was given through. Not null: this consent is only collectable on the applicant's
  -- own session, and a row without one would be a consent nobody can trace to an act.
  invitation_id        uuid not null unique references public.application_invitations(id) on delete cascade,
  -- The version stored on the row, so the day counsel's wording lands (A0) the difference between a
  -- consent to draft text and a consent to reviewed text is visible in the data, not in a changelog.
  disclosure_version   text not null,
  -- The exact composed text the driver was shown, whole. Not a reference to code that may change:
  -- `esignConsentBody()` composes it server-side today, and this column is what an audit reads.
  disclosure_text      text not null,
  intent_statement     text not null,
  consented_at         timestamptz not null default now(),
  -- 7001(c)(1)(B)(i)(II) is a right, so it needs somewhere to be exercised. Withdrawal does not undo
  -- what was already signed; it stops the electronic path going forward.
  withdrawn_at         timestamptz,
  -- The same three attribution facts every signature in this product carries (0215, 0220).
  applicant_ip         text,
  applicant_user_agent text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_esign_consents_driver on public.esign_consents (org_id, driver_id, consented_at desc);

alter table public.esign_consents enable row level security;
-- No client policies. Written by the public application API with the service role, read through the
-- authenticated API by the roles that read a qualification file. A browser session has no business
-- selecting from it, and nothing in the product needs it to.

comment on table public.esign_consents is
  'A4/D-APP5: the 15 U.S.C. 7001(c) consent that 49 CFR §390.32(d) requires an electronic §391.21 application to include proof of. Evidence — append-only for every writer including the service role, and in RETENTION_FORBIDDEN.';
comment on column public.esign_consents.disclosure_text is
  'The whole composed text the applicant was shown, stored beside their consent. A reference to code that may later change is not proof of what somebody agreed to.';
comment on column public.esign_consents.withdrawn_at is
  '7001(c)(1)(B)(i)(II): the consumer may withdraw. Withdrawal stops the electronic path going forward; it does not undo signatures already given, which is why this is a column and not a delete.';

-- Append-only, EI010-family: fires for the service role too. The one field a later act may set is
-- `withdrawn_at`, and only from null — a withdrawal cannot be un-withdrawn by an UPDATE either, since
-- resuming means giving consent again, which is a new row.
create or replace function public.guard_esign_consent_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
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

drop trigger if exists trg_guard_esign_consent on public.esign_consents;
create trigger trg_guard_esign_consent
  before update or delete on public.esign_consents
  for each row
  execute function public.guard_esign_consent_immutable();

-- ── RECORDING ONE IS ONE TRANSACTION ───────────────────────────────────────────────────────────
-- The row and the invitation's phase stamp are the same fact written twice, and either one without
-- the other is a worse state than neither: a stamped invitation with no row is a consent we cannot
-- produce, and a row with no stamp would let the gate ask for it again.
--
-- The refusals mirror `submit_driver_application`'s (0225), for the same reasons and with their own
-- codes: EC020 the invitation is not this org's and this driver's, EC021 it is revoked or expired,
-- EC022 this phase is already spent. A second consent on the same link is refused rather than
-- appended — the unique index says one consent per session, and D-APP5 makes it the first act on it.
create or replace function public.record_esign_consent(
  p_org        uuid,
  p_invitation uuid,
  p_driver     uuid,
  p_version    text,
  p_text       text,
  p_intent     text,
  p_ip         text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consented timestamptz;
  v_expires   timestamptz;
  v_revoked   timestamptz;
  v_id        uuid;
begin
  -- FOR UPDATE: a phase is only spent once if the check and the stamp are the same transaction.
  select consented_at, expires_at, revoked_at
    into v_consented, v_expires, v_revoked
    from public.application_invitations
   where id = p_invitation and org_id = p_org and driver_id = p_driver
   for update;

  if v_expires is null then
    raise exception 'application_invitation_not_found' using errcode = 'EC020';
  end if;
  if v_revoked is not null or v_expires <= now() then
    raise exception 'application_invitation_unusable' using errcode = 'EC021';
  end if;
  if v_consented is not null then
    raise exception 'esign_consent_already_given' using errcode = 'EC022';
  end if;

  insert into public.esign_consents
    (org_id, driver_id, invitation_id, disclosure_version, disclosure_text, intent_statement,
     applicant_ip, applicant_user_agent)
  values
    (p_org, p_driver, p_invitation, p_version, p_text, p_intent, p_ip, p_user_agent)
  returning id into v_id;

  update public.application_invitations
     set consented_at = now()
   where id = p_invitation and org_id = p_org;

  return jsonb_build_object('consent_id', v_id);
end;
$$;

revoke all on function public.record_esign_consent(uuid, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_esign_consent(uuid, uuid, uuid, text, text, text, text, text) to service_role;

comment on function public.record_esign_consent(uuid, uuid, uuid, text, text, text, text, text) is
  'A4: file the 15 U.S.C. 7001(c) consent and stamp the invitation''s consent phase — both or neither. Refuses an unknown invitation (EC020), a revoked or expired one (EC021) and a second consent on the same link (EC022).';
