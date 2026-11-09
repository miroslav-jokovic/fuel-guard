-- 0582 — a lead may be closed as not qualified for HOME TIME (ADS-LEAD-INTAKE-PLAN.md LQ7; audit F-LA4).
--
-- LQ7 adds `home_time` to `LEAD_REQUIREMENTS` (packages/shared/src/recruiting/leads/leadMatch.ts): the carrier's
-- Indeed screener asks "willing to stay on the road for 3 weeks?" (Joanna, 2026-11-06), a requirement the
-- carrier applies that Hiring Profile v1 did not name. `LEAD_CLOSE_REASONS` is DERIVED from that list
-- (`leadClosureContract.ts`), so `not_qualified:home_time` exists in shared from the same merge, and this CHECK
-- follows it — the matrix `recruiting-lead-closures.test.mjs` inserts every shared reason, which is why the list
-- and the CHECK move in ONE merge, never a reason ahead of its CHECK or a CHECK ahead of its list.
--
-- `close_lead` (0578) is redefined whole for the same reason: its own reason list is the CHECK's twin.
--
-- ⚠ DEPLOY WINDOW: a CHECK widened and a function's accepted set widened. Old code sends the old reasons, which
-- both still take.

alter table public.recruiting_lead_closures drop constraint if exists recruiting_lead_closures_reason_check;
alter table public.recruiting_lead_closures add constraint recruiting_lead_closures_reason_check
  check (reason is null or reason in (
    'not_qualified:age', 'not_qualified:class_a', 'not_qualified:class_a_experience', 'not_qualified:hazmat',
    'not_qualified:home_time',
    'not_qualified:dui', 'not_qualified:preventable_accident', 'not_qualified:clearinghouse', 'not_qualified:drug_alcohol',
    'not_interested', 'unreachable', 'wrong_number', 'duplicate', 'out_of_area', 'spam'));

-- close_lead, as 0578 wrote it, with home_time in its accepted set.
create or replace function public.close_lead(
  p_org uuid, p_lead uuid, p_reason text, p_note text, p_actor uuid, p_actor_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.recruiting_leads;
  v_status text;
  v_requirement text;
  v_attempts integer;
  v_pv uuid;
  v_id uuid;
  v_verdict boolean := false;
begin
  v_lead := public.lead_for_act('close_lead', p_org, p_lead, p_actor, p_actor_name);
  if p_reason is null or p_reason not in (
      'not_qualified:age', 'not_qualified:class_a', 'not_qualified:class_a_experience', 'not_qualified:hazmat',
      'not_qualified:home_time',
      'not_qualified:dui', 'not_qualified:preventable_accident', 'not_qualified:clearinghouse', 'not_qualified:drug_alcohol',
      'not_interested', 'unreachable', 'wrong_number', 'duplicate', 'out_of_area', 'spam') then
    raise exception 'close_lead: unknown close reason %', coalesce(p_reason, '(none)') using errcode = 'RL054';
  end if;
  if v_lead.status in ('not_qualified', 'lost') then
    return jsonb_build_object('lead_id', p_lead, 'closed', false, 'already', true, 'status', v_lead.status, 'verdict_written', false);
  end if;

  -- Evidence the reason needs, read from the contacts ledger — never a count the person typed.
  if p_reason in ('not_interested', 'wrong_number') then
    if not exists (select 1 from public.recruiting_contacts c
                    where c.org_id = p_org and c.lead_id = p_lead
                      and c.outcome = case p_reason when 'not_interested' then 'reached' else 'wrong_number' end) then
      raise exception 'close_lead: % needs a call with outcome % on record — log the call first',
        p_reason, case p_reason when 'not_interested' then 'reached' else 'wrong_number' end using errcode = 'RL055';
    end if;
  elsif p_reason = 'unreachable' then
    select count(*) into v_attempts from public.recruiting_contacts c
     where c.org_id = p_org and c.lead_id = p_lead and c.direction = 'outbound' and c.outcome in ('no_answer', 'voicemail');
    if v_attempts < 3 then
      raise exception 'close_lead: unreachable needs 3 outbound attempts with no answer on record; % recorded', v_attempts
        using errcode = 'RL056';
    end if;
  elsif p_reason = 'duplicate' then
    if jsonb_array_length(public.recruiting_lead_matches(p_org, p_lead) -> 'leads') = 0 then
      raise exception 'close_lead: duplicate needs another lead of the same person; none shares this phone or e-mail'
        using errcode = 'RL057';
    end if;
  end if;

  v_requirement := case when p_reason like 'not_qualified:%' then substr(p_reason, length('not_qualified:') + 1) end;
  v_status := case when v_requirement is not null then 'not_qualified' else 'lost' end;

  insert into public.recruiting_lead_closures (org_id, lead_id, kind, reason, status_after, note, actor, actor_name)
  values (p_org, p_lead, 'closed', p_reason, v_status, nullif(btrim(coalesce(p_note, '')), ''), p_actor, btrim(p_actor_name))
  returning id into v_id;
  update public.recruiting_leads set status = v_status, updated_at = now() where id = p_lead and org_id = p_org;

  -- The recruiter's verdict joins the rules' ledger, against the opening's current profile version.
  if v_requirement is not null and v_lead.opening_id is not null then
    select ov.profile_version_id into v_pv
      from public.recruiting_opening_versions ov
     where ov.org_id = p_org and ov.opening_id = v_lead.opening_id
     order by ov.version desc limit 1;
    if v_pv is not null then
      insert into public.lead_match_verdicts (org_id, lead_id, profile_version_id, requirement, verdict, evidence, detail)
      values (p_org, p_lead, v_pv, v_requirement, 'does_not_meet', 'verified',
              jsonb_build_object('hard', true, 'closure_id', v_id, 'by', 'recruiter'));
      v_verdict := true;
    end if;
  end if;

  return jsonb_build_object('lead_id', p_lead, 'closed', true, 'already', false, 'closure_id', v_id,
                            'status', v_status, 'verdict_written', v_verdict);
end;
$$;

revoke all on function public.close_lead(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
