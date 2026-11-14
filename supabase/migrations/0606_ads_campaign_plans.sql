-- 0606 — a campaign is planned before any ad is made (ADS-PLATFORM-V2-PLAN V2, owner 2026-11-14: "looks like AI
-- is in rush to create ad without any research").
--
-- ── WHAT THE GAP IS ─────────────────────────────────────────────────────────────────────────────────────
-- A campaign goes from `draft` straight to `composing`: the workers write, draw and check, and nothing
-- before them studied the job, our own results or anybody else's ads. The idea of each ad is whichever
-- preset the seeded draw turned up (D-AD11).
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────────────────────────────────
-- Two states in front of `composing`:
--   planning     — the evidence pack is built by code and the Strategist writes the plan from it;
--   plan_review  — a person reads the plan, edits or approves it.
-- and one table, `ads_campaign_plans`: a plan is a VERSION. The Strategist's is version 1; a person's edit
-- is the next version, never a change to the one before, so "what did the model propose and what did we
-- run" is two rows. `evidence` is the pack the plan was written from, kept whole beside it: an angle cites
-- evidence by id, and the id must still resolve after the opening, the figures and the swipe file have
-- moved on. `ads_campaigns.plan_id` names the version in force — set in the same compare-and-set move that
-- takes the campaign into `composing` (`transitions.ts`, the one writer of the row's state).
--
-- AX032: a campaign leaves `plan_review` for `composing` only with a plan of its own named. The machine
-- decides which move is legal (`campaignMachine.ts`, 0537's note on membership-only CHECKs); this is the
-- one fact the database must never see false, like AX020's approval and AX021's kill switch: an ad
-- composed "from the plan" with no plan on the row.
--
-- Append-only by 0537's guard (`ads_refuse_change('ledger')`, AX010). Row level security on, no client
-- policies: the API reads and writes with the service role and org-filters every query.
--
-- ⚠ DEPLOY WINDOW (docs/MIGRATION-DISCIPLINE.md): schema only. Nothing writes the two states, the table or
-- the column until the code of the NEXT merge; the code serving today never asks for them, and a CHECK
-- that allows more refuses nothing it allowed before. `draft → composing` stays legal for that code.

alter table public.ads_campaigns drop constraint if exists ads_campaigns_state_check;
alter table public.ads_campaigns add constraint ads_campaigns_state_check
  check (state in ('draft', 'planning', 'plan_review', 'composing', 'review', 'approved', 'creating', 'paused',
                   'launching', 'live', 'pausing', 'archived', 'failed'));

create table if not exists public.ads_campaign_plans (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  campaign_id   uuid not null,
  version       integer not null check (version >= 1),
  -- Validated by the shared contract before it is written (`campaignPlan.ts`, next merge); the database
  -- holds only the shapes that must never be false.
  plan          jsonb not null check (jsonb_typeof(plan) = 'object'),
  evidence      jsonb not null check (jsonb_typeof(evidence) = 'array'),
  -- Who wrote this version. An agent's names the model call that produced it (D-AD13: `ad_generations` is
  -- the provenance); a person's names the person, by id and by the name they had that day.
  author_kind   text not null check (author_kind in ('agent', 'person')),
  generation_id uuid,
  author_id     uuid,
  author_name   text check (author_name is null or length(btrim(author_name)) between 1 and 200),
  created_at    timestamptz not null default now(),
  unique (org_id, id),
  unique (org_id, campaign_id, version),
  check ((author_kind = 'agent' and generation_id is not null and author_id is null and author_name is null)
      or (author_kind = 'person' and generation_id is null and author_id is not null and author_name is not null)),
  foreign key (org_id, campaign_id) references public.ads_campaigns (org_id, id) on delete restrict,
  foreign key (org_id, generation_id) references public.ad_generations (org_id, id) on delete restrict
);
alter table public.ads_campaign_plans enable row level security;

drop trigger if exists trg_ads_campaign_plans_append_only on public.ads_campaign_plans;
create trigger trg_ads_campaign_plans_append_only before update or delete on public.ads_campaign_plans
  for each row execute function public.ads_refuse_change('ledger');

comment on table public.ads_campaign_plans is
  'V2 (0606): a campaign''s plan, one row per version, with the evidence pack it was written from. Append-only (AX010); RETENTION_FORBIDDEN. Service-role only.';

alter table public.ads_campaigns add column if not exists plan_id uuid;
alter table public.ads_campaigns drop constraint if exists ads_campaigns_plan_fk;
alter table public.ads_campaigns add constraint ads_campaigns_plan_fk
  foreign key (org_id, plan_id) references public.ads_campaign_plans (org_id, id) on delete restrict;

create or replace function public.guard_ads_campaign_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan_id is not null and new.plan_id is distinct from old.plan_id
     and not exists (select 1 from public.ads_campaign_plans p
                     where p.org_id = new.org_id and p.id = new.plan_id and p.campaign_id = new.id) then
    raise exception 'ads_campaigns: plan % is not a plan of this campaign', new.plan_id using errcode = 'AX032';
  end if;
  if old.state = 'plan_review' and new.state = 'composing' and new.plan_id is null then
    raise exception 'ads_campaigns: a campaign leaves plan review for composing only with its plan named'
      using errcode = 'AX032';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_ads_campaign_plan on public.ads_campaigns;
create trigger trg_guard_ads_campaign_plan before update on public.ads_campaigns
  for each row execute function public.guard_ads_campaign_plan();
