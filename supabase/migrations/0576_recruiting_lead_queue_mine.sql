-- 0576 · The lead queue can show one recruiter's leads (ADS-LEAD-QUALITY-PLAN LQ2c; Q-AD50 (a)).
--
-- THE GAP. Since LQ2b a new ad lead for an opening with a recruiter is that recruiter's (`assigned_to`), and only
-- they are rung. The queue cannot show them "mine": `recruiting_lead_queue` (0554) is keyset-paged and groups
-- leads into one row per person, so a filter in the browser over one page would be an incomplete list that looks
-- complete — the workaround the plan refused.
--
-- THE SHAPE. 0554's function, restated whole, with one more argument, `p_assigned uuid default null`. Null is
-- every row, exactly as before. A recruiter's id keeps the person-rows holding at least one of their open
-- leads — the row's first lead or one that rides on it — and filters before the page's limit.
--
-- WHY DROP, THEN CREATE. A new argument list is a new function in Postgres: `create or replace` would leave
-- 0554's five-argument version beside it, and PostgREST, given five named arguments both could take, refuses to
-- choose ("could not choose the best candidate function"). One transaction drops the old and creates the new.
--
-- DEPLOY WINDOW (MIGRATION-DISCIPLINE §the-deploy-window). Old code calls it with five NAMED arguments
-- (`leadQueue.ts`), which the new signature takes (the sixth defaults to null), so old code keeps working the
-- moment this applies. The first caller of `p_assigned` ships in the next merge (`lint:migration-ordering`).

drop function if exists public.recruiting_lead_queue(uuid, text[], timestamptz, uuid, integer);

create or replace function public.recruiting_lead_queue(
  p_org uuid, p_statuses text[], p_before_at timestamptz default null, p_before_id uuid default null,
  p_limit integer default 50, p_assigned uuid default null)
returns table (
  id uuid, channel text, source text, campaign_ref text, opening_id uuid, full_name text, phone_e164 text,
  email_lower text, status text, assigned_to uuid, received_at timestamptz, answers jsonb, also jsonb, drivers jsonb)
language sql
stable
set search_path = ''
as $$
  with open_leads as (
    select l.* from public.recruiting_leads l
     where l.org_id = p_org and l.status = any (p_statuses)
  ),
  primaries as (
    select l.* from open_leads l
     where not exists (
       select 1 from open_leads e
        where (e.received_at, e.id) < (l.received_at, l.id)
          and ((l.phone_e164 is not null and e.phone_e164 = l.phone_e164)
            or (l.email_lower is not null and e.email_lower = l.email_lower)))
       and (p_before_at is null or (l.received_at, l.id) < (p_before_at, p_before_id))
       -- 0576 (LQ2c): "Mine" keeps the person-rows holding at least one of this recruiter's open leads — the
       -- row's first lead, or one riding on it (`also`), so a returning person's newer lead is never hidden
       -- behind an older unowned one. Filtered BEFORE the limit, so a page of Mine is a full page.
       and (p_assigned is null or l.assigned_to = p_assigned or exists (
         select 1 from open_leads m
          where m.assigned_to = p_assigned and (m.received_at, m.id) > (l.received_at, l.id)
            and ((l.phone_e164 is not null and m.phone_e164 = l.phone_e164)
              or (l.email_lower is not null and m.email_lower = l.email_lower))))
     order by l.received_at desc, l.id desc
     limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select p.id, p.channel, p.source, p.campaign_ref, p.opening_id, p.full_name, p.phone_e164, p.email_lower,
         p.status, p.assigned_to, p.received_at, p.answers,
         coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'channel', o.channel, 'campaign_ref', o.campaign_ref,
                                                       'received_at', o.received_at) order by o.received_at, o.id)
                     from open_leads o
                    where o.id <> p.id and (o.received_at, o.id) > (p.received_at, p.id)
                      and ((p.phone_e164 is not null and o.phone_e164 = p.phone_e164)
                        or (p.email_lower is not null and o.email_lower = p.email_lower))), '[]'::jsonb),
         public.recruiting_lead_matches(p_org, p.id) -> 'drivers'
    from primaries p
   order by p.received_at desc, p.id desc;
$$;

revoke all on function public.recruiting_lead_queue(uuid, text[], timestamptz, uuid, integer, uuid) from public, anon, authenticated;

comment on function public.recruiting_lead_queue(uuid, text[], timestamptz, uuid, integer, uuid) is
  'D1 (0554), LQ2c (0576): the lead queue, one person per row (later leads with the same phone or email ride on it as also), newest first, keyset-paged on (received_at, id), at most 100. p_assigned keeps the rows holding one of that user''s open leads. Service-role only.';
