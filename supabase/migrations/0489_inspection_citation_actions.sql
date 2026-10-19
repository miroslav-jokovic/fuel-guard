-- 0489 — what the safety office did about a roadside ticket's court result (INSPECTION-CHALLENGE-PLAN IC4, R-ADJ1;
-- Q-IC2 (a): the safety office obtains the dispositions; owner 2026-10-19: proceed with IC4 as proposed).
--
-- ── WHY A TICKET NEEDS A RECORD OF ITS OWN ──────────────────────────────────────────────────────
-- FMCSA's feed carries a court's result only when the state sends one (`roadside_citations`). Measured
-- 2026-10-19: 165 tickets on our record, 144 with no result — 90 of them on inspections between 60 days and
-- 24 months old, the window in which a result still moves a CSA score (SMS counts 24 months; a dismissal
-- removes the violation, a different charge cuts it to severity 1, a paid ticket keeps it whole — the job
-- aid AdjudicatedCitations2025.pdf). The office's acts between "ticketed" and "the court decided" are
-- nowhere: who asked the court and when, and which tickets were paid and will never have a result to file.
-- This is where they are written.
--
--   requested_from_court  the office asked the court for its certified disposition; the step waits, and
--                         comes back when `follow_up_on` passes with nothing filed.
--   not_contested         the fine was paid or the ticket otherwise not fought. Closes the step for good:
--                         paying is a conviction of the original charge, so there is no result to obtain
--                         and nothing to file in DataQs (R-ADJ3).
--
-- A court result arriving — on FMCSA's feed, or as a filed `court_disposition` document — closes the step
-- whatever was written here; those live in their own tables and are not restated.
--
-- ── APPEND-ONLY, LIKE EVERY RECORD IN THIS MODULE ───────────────────────────────────────────────
-- A second request is a new row (the court did not answer); "not contested" said by mistake is answered by a
-- new `requested_from_court` row. The newest row is the state. Service role only; no client policy.

create table if not exists public.inspection_citation_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  -- The ticketed violation (0458): a ticket is one violation's `citation_number`.
  violation_id uuid not null,
  action text not null check (action in ('requested_from_court', 'not_contested')),
  -- The day the office will look again if nothing is filed: requested + 30 by default, the person's to move.
  follow_up_on date,
  -- Which court, a case number, who was spoken to — whatever the next person needs.
  note text check (note is null or length(note) <= 1000),
  acted_by uuid not null,
  created_at timestamptz not null default now(),
  constraint inspection_citation_actions_inspection_fk foreign key (inspection_id, org_id)
    references public.roadside_inspections (id, org_id),
  constraint inspection_citation_actions_violation_fk foreign key (violation_id, org_id)
    references public.roadside_violations (id, org_id),
  -- A request has a day to look again; "not contested" closes and has none.
  constraint inspection_citation_actions_follow_up check ((action = 'requested_from_court') = (follow_up_on is not null))
);

create index if not exists inspection_citation_actions_violation_idx
  on public.inspection_citation_actions (org_id, violation_id, created_at desc);
create index if not exists inspection_citation_actions_inspection_idx
  on public.inspection_citation_actions (org_id, inspection_id);

drop trigger if exists trg_inspection_citation_actions_append_only on public.inspection_citation_actions;
create trigger trg_inspection_citation_actions_append_only
  before update or delete on public.inspection_citation_actions
  for each row execute function public.inspection_evidence_append_only();

alter table public.inspection_citation_actions enable row level security;

comment on table public.inspection_citation_actions is
  'IC4 (0489): the safety office''s acts on a roadside ticket with no court result — requested from the court (with a day to follow up) or not contested. Append-only, newest row is the state, service role only.';
