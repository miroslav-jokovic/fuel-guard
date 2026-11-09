-- 0574 · An opening names the recruiter who owns its leads (ADS-LEAD-QUALITY-PLAN LQ2a; Q-AD50 ruled (a) 2026-11-09).
--
-- THE GAP. `recruiting_leads.assigned_to` (0553) exists, and nothing has ever written it: `leadNotify.ts` rings
-- everyone who holds recruitment manage for every lead ("⚠ NO ASSIGNEE TIER"). Tenstreet's data on 1.5 M
-- drivers puts the hire rate at 6.2 % when a carrier answers within five minutes against a 3.7 % average, and a
-- lead everybody was told about is a lead nobody in particular owns. The owner ruled (Q-AD50 (a)): each
-- opening names a recruiter; that opening's leads are theirs; an opening without one rings everybody, as today.
--
-- WHY THE PARENT ROW, NOT THE VERSION. A version is what the opening SAYS (pay, area, the words an ad may
-- claim — immutable, RL012). Who works its leads is not part of what it advertises: handing an opening to
-- another recruiter must not mint a new version, and so must not invite a new campaign brief. The parent
-- already carries the other operational fact, `status`.
--
-- WHY A PLAIN FK TO auth.users (on delete set null). The same as `recruiting_leads.assigned_to` (0553), so the
-- two "which person" columns behave alike. Membership and the right to work leads are NOT schema facts here:
-- they change on the Permissions page, so the API asks the access matrix at save time AND at ring time
-- (LQ2b) — a recruiter whose recruitment-manage grant was taken away stops being rung without anyone
-- editing the opening. A composite FK to a membership row was rejected: it would freeze a role fact the
-- matrix owns, and composite FKs break PostgREST embeds (memory: same_org FK breaks embeds).
--
-- DEPLOY WINDOW (MIGRATION-DISCIPLINE §the-deploy-window). A nullable column with no default: old code never
-- names it and keeps working; its first reader ships in the NEXT merge (LQ2b, lint:migration-ordering).

alter table public.recruiting_openings
  add column if not exists recruiter_id uuid references auth.users(id) on delete set null;

create index if not exists ix_recruiting_openings_recruiter
  on public.recruiting_openings (org_id, recruiter_id) where recruiter_id is not null;

comment on column public.recruiting_openings.recruiter_id is
  'LQ2a (0574), Q-AD50 (a): the recruiter who owns this opening''s leads; null = every recruitment manager is rung (leadNotify.ts). Whether the person may still work leads is the access matrix''s, asked by the API, not this column''s.';
