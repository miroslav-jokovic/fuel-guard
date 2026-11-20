-- 0641 — the public apply page's schema (APPLY-PAGE-PLAN AP1; Q-APX31 (a), Q-APX34 (a), 2026-11-20).
--
-- Three changes, each read by nothing in the merge that adds it except the Settings card's own table:
--
-- 1. `recruiting_careers_pages` (new): one row per carrier — the handle its public address is built from
--    (`/careers/<handle>`, D-AP1), whether the page is on, and the accommodation contact the page's footer
--    names (D-AP7). The handle lookup is the one public query not scoped to an org (as `tenstreet_connections.
--    key_hash` is for Tenstreet); everything after it is scoped to the org it found.
--
-- 2. `sms_consents.lead_id`: a consent ticked on the apply page belongs to a LEAD, not a driver. 0233's header
--    left the column out until "there is something for it to reference"; `recruiting_leads` (0553) is that.
--    `driver_id` becomes nullable and exactly one of the two is set. The guard trigger now holds `lead_id` as
--    immutable too: a consent's subject is part of what was agreed.
--    ⚠ Consent reads before a send are keyed by driver (`applicationSms.ts`, `smsOutbox.ts`), so a lead's consent
--    permits no text today — texting a lead is APPLY-PAGE-PLAN Q-AP1. A STOP reads by number, and AP2 changes it
--    to revoke by number before the first lead row is written (`honourStop` withdraws per driver today).
--
-- 3. `purge_lead` (0578's) is redefined whole to also delete the lead's consents, which hold the phone number,
--    and say how many. The applicant purge (0380 onwards) deletes an applicant's consents the same way: an
--    explicit, audited service-role act, not a retention side effect (`RETENTION_FORBIDDEN` still pins the
--    table against any schedule).
--
-- cross-module-waiver: none — recruiting's tables, written by recruiting.
--
-- ⚠ DEPLOY WINDOW: (1) is a new table, read and written in this merge by the Settings card (exempt). (2) is a new
-- column and a relaxed NOT NULL; old code never names `lead_id` and always sets `driver_id`, which the new check
-- accepts. Its first writer is AP2, a later merge (`lint:migration-ordering`). (3) returns one more key; the
-- caller (`leadPurge.ts`) reads the keys it knows.

-- ── 1. the careers page ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.recruiting_careers_pages (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null unique references public.organizations(id) on delete cascade,
  -- 3–40 characters, lower-case letters, digits and inner hyphens: it is a path segment people type.
  handle               text not null unique check (handle ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  enabled              boolean not null default false,
  accommodation_email  text check (accommodation_email is null or (length(accommodation_email) <= 320
                         and accommodation_email = lower(accommodation_email) and accommodation_email ~ '^[^@\s]+@[^@\s]+$')),
  accommodation_phone  text check (accommodation_phone is null or accommodation_phone ~ '^\+[1-9][0-9]{7,14}$'),
  updated_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (org_id, id),
  -- D-AP7: a published page names somebody to ask for an accommodation.
  check (not enabled or accommodation_email is not null or accommodation_phone is not null)
);
alter table public.recruiting_careers_pages enable row level security;

comment on table public.recruiting_careers_pages is
  'AP1 (0641): one carrier''s public careers page — the handle of /careers/<handle>, on/off, and the accommodation contact its footer names. Written by recruiting/careers.';

-- ── 2. a consent may belong to a lead ───────────────────────────────────────────────────────────────
alter table public.sms_consents add column if not exists lead_id uuid;
alter table public.sms_consents alter column driver_id drop not null;
alter table public.sms_consents drop constraint if exists sms_consents_lead_fk;
alter table public.sms_consents add constraint sms_consents_lead_fk
  foreign key (org_id, lead_id) references public.recruiting_leads (org_id, id) on delete cascade;
alter table public.sms_consents drop constraint if exists sms_consents_one_subject;
alter table public.sms_consents add constraint sms_consents_one_subject
  check (num_nonnulls(driver_id, lead_id) = 1);
create index if not exists idx_sms_consents_lead
  on public.sms_consents (org_id, lead_id) where lead_id is not null;

comment on column public.sms_consents.lead_id is
  'AP1 (0641): the lead whose apply-page box this is (source lead_form); exactly one of driver_id and lead_id is set. No send path reads it yet (APPLY-PAGE-PLAN Q-AP1).';

create or replace function public.guard_sms_consent_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.org_id is distinct from new.org_id
     or old.driver_id is distinct from new.driver_id
     or old.lead_id is distinct from new.lead_id
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

-- ── 3. purging a lead takes its consents ────────────────────────────────────────────────────────────
create or replace function public.purge_lead(p_org uuid, p_lead uuid, p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead record;
  v_verdicts bigint;
  v_contacts bigint;
  v_notes bigint;
  v_consents bigint;
begin
  if p_org is null or p_lead is null or p_actor is null then
    raise exception 'purge_lead: org, lead and actor are all required' using errcode = 'RL043';
  end if;
  if not exists (select 1 from public.memberships m where m.org_id = p_org and m.user_id = p_actor and m.role = 'admin') then
    raise exception 'purge_lead: only an admin of the carrier may delete a lead''s details' using errcode = 'RL042';
  end if;
  select id, purged_at into v_lead from public.recruiting_leads where id = p_lead and org_id = p_org for update;
  if not found then
    raise exception 'purge_lead: lead % is not this carrier''s', p_lead using errcode = 'RL040';
  end if;
  if exists (select 1 from public.lead_conversions c where c.org_id = p_org and c.lead_id = p_lead) then
    raise exception 'purge_lead: lead % became an applicant; purge the applicant', p_lead using errcode = 'RL041';
  end if;
  select count(*) into v_contacts from public.recruiting_contacts where org_id = p_org and lead_id = p_lead;
  if v_lead.purged_at is not null then
    -- A lead purged before 0641 has no consents; one purged after had them deleted with it. Either way, and for
    -- a consent written after a purge by a racing submission, the rows go now.
    delete from public.sms_consents where org_id = p_org and lead_id = p_lead;
    get diagnostics v_consents = row_count;
    return jsonb_build_object('lead_id', p_lead, 'purged', false, 'already', true, 'verdicts_deleted', 0,
                              'contacts_kept', v_contacts, 'closure_notes_cleared', 0, 'sms_consents_deleted', v_consents);
  end if;

  perform set_config('fuelguard.purging_lead', p_lead::text, true);
  update public.recruiting_leads
     set full_name = null, phone_e164 = null, email_lower = null, answers = '{}'::jsonb, raw = '{}'::jsonb,
         assigned_to = null, status = 'lost', purged_at = now()
   where id = p_lead and org_id = p_org;
  delete from public.lead_match_verdicts where org_id = p_org and lead_id = p_lead;
  get diagnostics v_verdicts = row_count;
  update public.recruiting_lead_closures set note = null where org_id = p_org and lead_id = p_lead and note is not null;
  get diagnostics v_notes = row_count;
  delete from public.sms_consents where org_id = p_org and lead_id = p_lead;
  get diagnostics v_consents = row_count;
  perform set_config('fuelguard.purging_lead', '', true);

  return jsonb_build_object('lead_id', p_lead, 'purged', true, 'already', false, 'verdicts_deleted', v_verdicts,
                            'contacts_kept', v_contacts, 'closure_notes_cleared', v_notes, 'sms_consents_deleted', v_consents);
end;
$$;
