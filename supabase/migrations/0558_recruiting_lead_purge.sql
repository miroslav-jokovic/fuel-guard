-- 0558 — deleting a lead's personal details on request (2026-11-03 lead-path audit, H2). The reader is
-- the next merge (`POST /recruitment/leads/:id/purge`).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- A person who never became an applicant could not be removed. `purge_applicant` (0380, extended in
-- 0553) removes a CONVERTED lead whole, with its applicant; nothing reached an unconverted one. And a
-- plain DELETE could not either, once anybody had logged a call: `recruiting_contacts` points at the
-- lead `on delete restrict`, and refuses its own delete (RL010) — on purpose, because contacts are
-- evidence and the lead is not (D-RA12). A deletion request (CCPA/CPRA, or anybody asking) had no answer.
--
-- ── WHY A REDACTION, NOT A DELETE ──────────────────────────────────────────────────────────────
-- `purge_lead` empties the row instead of removing it: name, phone, email, answers and the raw payload
-- go, the match verdicts (computed from those answers) go, the assignee goes, and the row is stamped
-- `purged_at` and `lost`. What stays is an anonymous tombstone — channel, source, campaign, opening,
-- the channel's own id and the dates — for three reasons:
--   · The channel still holds the lead. Meta keeps it 90 days, and the hourly backfill reads up to 90
--     days back (`catchUpSince`). A deleted row would be re-imported within the hour, details and all;
--     a row that keeps its `(org, channel, external_ref)` is `ingest_lead`'s duplicate, which changes
--     nothing on the stored row (0554).
--   · `recruiting_contacts` keep pointing at it. They are kept whole (D-RA12) — who called, when, by
--     which means, with what outcome — as the record a TCPA or discrimination claim is answered from.
--     Their free-text `note` is a recruiter's words, kept with them; counsel's question, not this file's.
--   · The spend report counts leads per campaign (D-LS5); an anonymous lead still counted once.
-- A number held from contact (`sms_suppressions`, the do-not-contact hold) is NOT removed: deleting it
-- would re-open texting to a person who asked not to be contacted.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
--   · `recruiting_leads.purged_at` — set once by the purge, never cleared.
--   · `purging_lead(lead)` — the transaction-local exemption, 0380's `purging_applicant` pattern: the
--     id, not a switch, so it opens the guard for THIS lead only, and a new name so the audit of why a
--     guard let a change through reads "a purge".
--   · `guard_recruiting_leads` redefined whole: RL013 (attribution and raw frozen) lets `raw` become
--     `{}` only under that exemption, and a purged lead refuses any personal detail written back
--     (RL044).
--   · `purge_lead(org, lead, actor)` — admin only, read again here as 0380 does (RL042); another
--     carrier's lead reads as no lead (RL040); a converted lead is refused (RL041: purge the applicant,
--     which takes the lead whole). A second purge of the same lead changes nothing and says so.
--
--   RL040  purge_lead: the lead is not this carrier's
--   RL041  purge_lead: the lead became an applicant — purge the applicant instead
--   RL042  purge_lead: the actor is not an admin of the carrier
--   RL043  purge_lead: org, lead and actor are all required
--   RL044  recruiting_leads: a purged lead's details stay empty
--
-- ⚠ DEPLOY WINDOW: a new nullable column, a redefined guard that refuses only what nothing writes (raw
-- is never updated by the api; a purged lead does not exist before this), and a new function nothing
-- calls until the next merge. Old code meets the new schema unchanged.

alter table public.recruiting_leads add column if not exists purged_at timestamptz;

create or replace function public.purging_lead(p_lead uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('fuelguard.purging_lead', true) = p_lead::text, false);
$$;

create or replace function public.guard_recruiting_leads()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.channel <> old.channel
     or new.external_ref is distinct from old.external_ref
     or new.source is distinct from old.source
     or new.campaign_ref is distinct from old.campaign_ref
     or new.opening_id is distinct from old.opening_id
     or new.platform_created_at is distinct from old.platform_created_at
     or (new.raw <> old.raw and not (public.purging_lead(old.id) and new.raw = '{}'::jsonb))
     or new.received_at <> old.received_at
     or new.created_at <> old.created_at
     or (old.purged_at is not null and new.purged_at is distinct from old.purged_at) then
    raise exception 'recruiting_leads: a lead''s attribution and raw payload never change' using errcode = 'RL013';
  end if;
  if new.purged_at is not null
     and (new.full_name is not null or new.phone_e164 is not null or new.email_lower is not null
          or new.answers <> '{}'::jsonb or new.raw <> '{}'::jsonb) then
    raise exception 'recruiting_leads: a purged lead''s details stay empty' using errcode = 'RL044';
  end if;
  return new;
end;
$$;

create or replace function public.purge_lead(p_org uuid, p_lead uuid, p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead record;
  v_verdicts bigint;
  v_contacts bigint;
begin
  if p_org is null or p_lead is null or p_actor is null then
    raise exception 'purge_lead: org, lead and actor are all required' using errcode = 'RL043';
  end if;
  if not exists (select 1 from public.memberships m
                  where m.org_id = p_org and m.user_id = p_actor and m.role = 'admin') then
    raise exception 'purge_lead: only an admin of the carrier may delete a lead''s details' using errcode = 'RL042';
  end if;

  -- Locked, so a conversion racing this purge waits and then finds an empty lead (or this waits for it).
  select id, purged_at into v_lead from public.recruiting_leads where id = p_lead and org_id = p_org for update;
  if not found then
    raise exception 'purge_lead: lead % is not this carrier''s', p_lead using errcode = 'RL040';
  end if;
  if exists (select 1 from public.lead_conversions c where c.org_id = p_org and c.lead_id = p_lead) then
    raise exception 'purge_lead: lead % became an applicant; purge the applicant', p_lead using errcode = 'RL041';
  end if;
  select count(*) into v_contacts from public.recruiting_contacts where org_id = p_org and lead_id = p_lead;
  if v_lead.purged_at is not null then
    return jsonb_build_object('lead_id', p_lead, 'purged', false, 'already', true, 'verdicts_deleted', 0, 'contacts_kept', v_contacts);
  end if;

  perform set_config('fuelguard.purging_lead', p_lead::text, true);
  update public.recruiting_leads
     set full_name = null, phone_e164 = null, email_lower = null, answers = '{}'::jsonb, raw = '{}'::jsonb,
         assigned_to = null, status = 'lost', purged_at = now()
   where id = p_lead and org_id = p_org;
  delete from public.lead_match_verdicts where org_id = p_org and lead_id = p_lead;
  get diagnostics v_verdicts = row_count;
  perform set_config('fuelguard.purging_lead', '', true);

  return jsonb_build_object('lead_id', p_lead, 'purged', true, 'already', false, 'verdicts_deleted', v_verdicts, 'contacts_kept', v_contacts);
end;
$$;

comment on function public.purge_lead(uuid, uuid, uuid) is
  '2026-11-03 lead-path audit H2: empties an unconverted lead''s personal details (name, phone, email, answers, raw) and deletes its match verdicts, leaving an anonymous tombstone so the channel''s backfill reads it as a duplicate and its contacts stay. Refuses RL040 not this carrier''s, RL041 converted (purge the applicant), RL042 actor not an admin, RL043 missing argument. Idempotent. The api writes the audit row.';

revoke all on function public.purging_lead(uuid) from public, anon, authenticated;
revoke all on function public.purge_lead(uuid, uuid, uuid) from public, anon, authenticated;
