-- 0471 — one row per attempt to create an applicant in Med-Stop from Part 1 (MEDSTOP-PLAN.md §7A.13,
-- D-MS1, batch UX5c).
--
-- ── WHY A RECORD OF THE ATTEMPT, AND NOT JUST THE RESULT ────────────────────────────────────────
-- Creating a donor in Med-Stop is a write to the carrier's real account (there is no test host, Q-MS2).
-- It is sent ONCE and never retried (`MEDSTOP_WRITES`, D-MSUX8): a POST that timed out may have
-- landed, and a retry would make a second Med-Stop person. So the sweep must know it already tried —
-- whatever happened — before it looks at the applicant again. `invitation_id` is unique for that
-- reason: one attempt per application, ever. A refusal is not retried either; the office adds the
-- person by hand, as it does today, and the step shows Med-Stop's own sentence so it knows why.
--
-- `unknown` heals itself: the next sweep reads Med-Stop's applicant roster, and a person who did land
-- is matched by licence and shows on the step like anybody else.
--
-- ── WHY KEYED BY THE INVITATION, NOT THE DRIVER ─────────────────────────────────────────────────
-- An application is what Part 1 belongs to, and a rehire's second application is a second Med-Stop
-- question. Keyed by invitation, the row also leaves with the applicant's purge (0380 deletes the
-- invitations; this cascades) and needs no place in merge_driver (check-driver-references).
--
-- New table: `lint:migration-ordering` lets its first reader ship in the same merge.
create table if not exists public.medstop_applicant_creates (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  invitation_id uuid not null unique references public.application_invitations(id) on delete cascade,
  outcome       text not null check (outcome in ('created', 'refused', 'unknown')),
  -- Med-Stop's employee id when its answer carried one.
  medstop_id    text,
  -- Med-Stop's own sentence for a refusal or a timeout; never the form we sent.
  message       text,
  attempted_at  timestamptz not null default now()
);

create index if not exists medstop_applicant_creates_org_idx
  on public.medstop_applicant_creates (org_id, invitation_id);

-- Service role only: no client policy (deny-all on purpose). Read by the api for the hiring step.
alter table public.medstop_applicant_creates enable row level security;

comment on table public.medstop_applicant_creates is
  'UX5c (0471, D-MS1): one attempt per application to create the applicant in Med-Stop — created | refused | unknown. Sent once, never retried; written by the Med-Stop sweep, read by the hiring step.';
