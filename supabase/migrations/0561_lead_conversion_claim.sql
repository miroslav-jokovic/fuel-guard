-- 0561 — a lead is turned into ONE applicant even when Convert is pressed twice (2026-11-03 lead-path
-- audit, M1). The reader is the next merge (`leads/leadQueue.ts` `convertLead`).
--
-- ── WHAT GAP ───────────────────────────────────────────────────────────────────────────────────
-- Converting a lead with no applicant yet is three steps from the api: check the lead is not converted,
-- create the applicant through roster's one door (`createDriverRecord`, which writes its own audit row),
-- then `convert_lead` (0554), which locks the lead and records the conversion. Two requests at once —
-- a double click, two recruiters — both passed the check and both created an applicant; the second
-- `convert_lead` was refused (RL022) and its applicant stayed behind, an orphan on the board with the
-- lead's name and number. `convert_lead`'s lock cannot help: it runs after both creates.
--
-- ── THE SHAPE ──────────────────────────────────────────────────────────────────────────────────
-- A claim taken BEFORE the create, in one statement:
--   · `recruiting_leads.conversion_claimed_at` — when a conversion of this lead started.
--   · `claim_lead_conversion(org, lead)` → 'claimed' | 'busy' | 'converted'. One conditional UPDATE: it
--     claims only a lead that is not converted and holds no live claim, so of two requests at once
--     exactly one is answered 'claimed'. Another carrier's lead reads as no lead (RL020, 0554's code).
--   · A claim is live for `2 minutes` and then lapses by itself: a request that crashed between the claim
--     and the conversion leaves a lead that can be converted again two minutes later, never one stuck.
--     A create and a conversion take well under a second.
--   · `release_lead_conversion(org, lead)` — the api gives a claim back when the create or the conversion
--     fails, so the recruiter's retry is not made to wait out the two minutes.
-- The column is the recruiter's process state, not attribution: RL013 does not freeze it.
--
-- ⚠ DEPLOY WINDOW: a new nullable column and two new functions nothing calls until the next merge. Old
-- code meets the new schema unchanged.

alter table public.recruiting_leads add column if not exists conversion_claimed_at timestamptz;

create or replace function public.claim_lead_conversion(p_org uuid, p_lead uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.recruiting_leads
     set conversion_claimed_at = now()
   where org_id = p_org and id = p_lead and status <> 'converted'
     and (conversion_claimed_at is null or conversion_claimed_at < now() - interval '2 minutes');
  if found then
    return 'claimed';
  end if;
  select status into v_status from public.recruiting_leads where org_id = p_org and id = p_lead;
  if not found then
    raise exception 'claim_lead_conversion: lead % is not this carrier''s', p_lead using errcode = 'RL020';
  end if;
  return case when v_status = 'converted' then 'converted' else 'busy' end;
end;
$$;

create or replace function public.release_lead_conversion(p_org uuid, p_lead uuid)
returns void
language sql
set search_path = ''
as $$
  update public.recruiting_leads set conversion_claimed_at = null where org_id = p_org and id = p_lead;
$$;

comment on function public.claim_lead_conversion(uuid, uuid) is
  '2026-11-03 lead-path audit M1: claims a lead for conversion before its applicant is created, so two requests at once create one applicant. Answers claimed | busy (a live claim, under 2 minutes old) | converted; RL020 another carrier''s lead.';

revoke all on function public.claim_lead_conversion(uuid, uuid) from public, anon, authenticated;
revoke all on function public.release_lead_conversion(uuid, uuid) from public, anon, authenticated;
