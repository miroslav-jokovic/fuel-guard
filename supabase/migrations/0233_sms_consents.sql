-- 0233 — consent to be texted (APPLICATION-SYSTEM-PLAN A11b, D-APP13).
--
-- ── WHY EMAIL NEEDED NO TABLE AND THIS DOES ────────────────────────────────────────────────────
-- D-APP13's sentence: SMS is not a delivery mechanism, it is a consent regime. The TCPA assesses
-- $500 to $1,500 PER MESSAGE, and the only defence is the record of what somebody agreed to, when,
-- in what words, and whether they later told us to stop. That record is this table.
--
-- ── ⚠ WHAT THE REGULATION ACTUALLY GOVERNS ────────────────────────────────────────────────────
-- 47 CFR §64.1200(f)(9) defines "prior express written consent" — a signature, plus a disclosure that
-- the signer is not required to agree as a condition of anything — for "advertisements or
-- telemarketing messages". A text to somebody about their OWN in-progress job application is a weaker
-- case for that classification than a marketing blast; a reasonable lawyer might call it transactional
-- and outside it. The full written consent is collected anyway, because being conservative costs one
-- checkbox and being wrong costs per message. WHICH classification applies is counsel's call and not
-- an engineer's — the same division this plan applies to every other instrument (A0).
--
-- ── EVIDENCE, NOT OPERATIONAL ──────────────────────────────────────────────────────────────────
-- EI010's guard style — fires for the SERVICE ROLE TOO — and `RETENTION_FORBIDDEN`. The opposite of
-- the choice 0226 and 0230 made for drafts and captures, and for the opposite reason: a consent whose
-- text could be edited after the fact is not evidence of anything, and a consent pruned on a schedule
-- is a defence thrown away while the claim is still live. `revoked_at` is the ONLY mutable column,
-- because a `STOP` must always be recordable.
--
-- ── ⚠ THERE IS NO `lead_id`, AND A11'S TEXT ASKS FOR ONE ──────────────────────────────────────
-- "`driver_id` or `lead_id`" — but there is no `leads` table. R1 in RECRUITING-SYSTEM-PLAN builds it
-- and has not been executed, and a nullable uuid pointing at a table that does not exist is precisely
-- what 0146's header criticised `master_documents` for: a column reserved for a future that reads, to
-- everyone after, like a relationship somebody forgot to wire up. An applicant IS a `drivers` row with
-- `status='applicant'`, so every path this plan builds works on `driver_id` alone. R1 adds the column
-- when there is something for it to reference.
create table if not exists public.sms_consents (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  driver_id      uuid not null references public.drivers(id) on delete cascade,
  -- E.164. Consent attaches to a NUMBER, not to a person: a driver who changes phones has not
  -- consented on the new one, and an inbound STOP arrives as a number and nothing else.
  phone          text not null,
  -- The exact words agreed to, stored beside the agreement — 0092's rule for `hazmat_reviews.
  -- attestation` and 0215's for disclosures. Today's constant is not what somebody signed last year.
  consent_text   text not null,
  consent_version text not null,
  intent_statement text not null,
  source         text not null check (source in ('application','lead_form','office')),
  granted_at     timestamptz not null default now(),
  -- The only column that may change after the fact. An opt-out that could not be recorded would be
  -- the one failure a consent regime is least able to explain.
  revoked_at     timestamptz,
  -- How the opt-out arrived — the keyword texted, or who recorded it in the office.
  revoked_reason text,
  -- The same three attribution facts every signature in this product carries (0215, A4).
  granted_ip     text,
  granted_user_agent text,
  created_at     timestamptz not null default now()
);

-- "May we text this number right now?" — the read in front of every send, and the read an inbound
-- STOP does to find what to revoke. Partial on the live rows, which is all either question asks about.
create index if not exists idx_sms_consents_live
  on public.sms_consents (org_id, phone) where revoked_at is null;
create index if not exists idx_sms_consents_driver
  on public.sms_consents (org_id, driver_id);

alter table public.sms_consents enable row level security;
-- No client policies — deny-all, API-only. The applicant grants through the public token surface and
-- the office reads through the authenticated API; neither is a browser talking to PostgREST.

comment on table public.sms_consents is
  'A11b/D-APP13: prior express consent to text one number about one driver''s application, with the exact wording agreed to. EVIDENCE — EI010-style guard (fires for the service role too) and RETENTION_FORBIDDEN, because a consent that can be edited is not evidence and one pruned on a schedule is a defence discarded while the claim is live. revoked_at is the only mutable column.';
comment on column public.sms_consents.phone is
  'E.164. Consent attaches to the NUMBER: a driver who changes phones has not consented on the new one, and an inbound STOP arrives as a number and nothing else.';

-- ── APPEND-ONLY, EXCEPT FOR THE OPT-OUT ────────────────────────────────────────────────────────
-- EI010's family, which fires for the service role as well: nothing may rewrite what somebody agreed
-- to, ever, including us. `revoked_at` and `revoked_reason` are exempt because a `STOP` must always
-- land — and once set, `revoked_at` may not be cleared, because un-revoking a consent is exactly the
-- act this table exists to make impossible.
create or replace function public.guard_sms_consent_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.org_id is distinct from new.org_id
     or old.driver_id is distinct from new.driver_id
     or old.phone is distinct from new.phone
     or old.consent_text is distinct from new.consent_text
     or old.consent_version is distinct from new.consent_version
     or old.intent_statement is distinct from new.intent_statement
     or old.source is distinct from new.source
     or old.granted_at is distinct from new.granted_at
     or old.granted_ip is distinct from new.granted_ip
     or old.granted_user_agent is distinct from new.granted_user_agent
  then
    raise exception 'sms_consent_immutable' using errcode = 'SC010';
  end if;
  if old.revoked_at is not null and new.revoked_at is null then
    raise exception 'sms_consent_revocation_is_final' using errcode = 'SC011';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_sms_consent on public.sms_consents;
create trigger trg_guard_sms_consent
  before update on public.sms_consents
  for each row
  execute function public.guard_sms_consent_immutable();

-- ── REVOKING: ONE STATEMENT, EVERY LIVE CONSENT ON THAT NUMBER ─────────────────────────────────
-- An inbound STOP names a number and nothing else, so it revokes every live consent on it. Deliberate:
-- a driver who texts STOP has not opted out of one application, they have said do not text me. Scoped
-- to the org because the service role bypasses RLS, and the inbound webhook resolves the org from the
-- number rather than accepting one.
create or replace function public.revoke_sms_consent(
  p_org    uuid,
  p_phone  text,
  p_reason text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.sms_consents
     set revoked_at = now(),
         revoked_reason = p_reason
   where org_id = p_org
     and phone = p_phone
     and revoked_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.revoke_sms_consent(uuid, text, text) from public, anon, authenticated;
grant execute on function public.revoke_sms_consent(uuid, text, text) to service_role;

comment on function public.revoke_sms_consent(uuid, text, text) is
  'A11b: honour an opt-out. Revokes EVERY live consent on the number, because a driver who texts STOP has not opted out of one application — they have said do not text me. Idempotent: a second STOP revokes nothing and returns 0.';
