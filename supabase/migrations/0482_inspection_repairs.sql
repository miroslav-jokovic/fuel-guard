-- 0482 — the repair record of a roadside inspection's vehicle violations (INSPECTION-CHALLENGE-PLAN IC11,
-- D-IC14; Q-IC12 (a), Q-IC13, Q-IC14 measured 2026-10-16).
--
-- ── WHAT 396.9(d) ASKS, AND WHERE THE ANSWER LIVES ───────────────────────────────────────────────
-- Every violation on a roadside report is corrected, the repair is in the unit's maintenance record, and a
-- carrier official certifies the report within 15 days of the inspection. Our maintenance record is
-- FleetPal's (`fleetpal_work_orders`, units matched to ours since the 2026-10-15 units sweep), so each
-- inspected unit with a Part 393/396 violation gets a row here naming the FleetPal work orders that could
-- be its repair, and the due date.
--
-- ── PROPOSED BY THE ENGINE, ACCEPTED BY A PERSON ─────────────────────────────────────────────────
-- Measured 2026-10-16 (last year, 148 violated units): 56 had exactly one work order opened in the 15
-- days, 28 several, 49 none, 15 repaired at the scene. Exactly one is 38%, so the engine only proposes
-- (`source = 'engine'`, `candidates` frozen as it read them); maintenance accepts THE work order or says
-- the repair was done outside FleetPal (`source = 'person'`, Q-IC13). The person rows' writer ships in
-- the next merge; their shape is pinned here so it cannot be invented later.
--
-- ── APPEND-ONLY, LIKE EVERY READING IN THIS MODULE ───────────────────────────────────────────────
-- An engine row is written when the unit's candidates change (a work order opens, closes, is
-- cancelled) — `candidates_sha256` is what the pass compares — and a new `engine_version` reads every
-- open unit again. The latest row per unit is its state; nothing is updated or deleted, so "what did
-- the system propose on day 12" is still answerable at an audit. No FK to FleetPal's tables (another
-- module's, re-synced) or to `auth.users`, for 0473's reasons.
--
-- New table: its writer, the repair pass on the FMCSA hourly tick, ships in the same merge.

create table if not exists public.inspection_repairs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null,
  -- The inspected unit the violations were written against (0458's `roadside_violations.unit_id`).
  inspection_unit_id uuid not null,
  source text not null check (source in ('engine', 'person')),
  engine_version text not null check (length(btrim(engine_version)) > 0),
  outcome text not null check (outcome in (
    'repaired_at_scene', 'one_candidate', 'several_candidates', 'no_candidate', 'no_fleetpal_unit', 'unit_not_ours',
    'accepted', 'repaired_outside_fleetpal'
  )),
  -- The inspection's calendar day + 15 (396.9(d)(3)).
  due_on date not null,
  -- The FleetPal work orders proposed, ranked, as read (RepairCandidate[] in @silvicom/shared).
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array'),
  candidates_sha256 text check (candidates_sha256 is null or candidates_sha256 ~ '^[0-9a-f]{64}$'),
  -- A person's row only: who decided, the work order they named, and why when it is not one.
  decided_by uuid,
  work_order_fleetpal_id text,
  note text,
  created_at timestamptz not null default now(),
  constraint inspection_repairs_inspection_fk
    foreign key (inspection_id, org_id) references public.roadside_inspections (id, org_id),
  constraint inspection_repairs_unit_fk
    foreign key (inspection_unit_id, org_id) references public.roadside_inspection_units (id, org_id),
  constraint inspection_repairs_person_named check ((source = 'person') = (decided_by is not null)),
  -- The engine proposes; only a person accepts or says "outside FleetPal".
  constraint inspection_repairs_outcome_by_source check (
    (source = 'engine') = (outcome not in ('accepted', 'repaired_outside_fleetpal'))
  ),
  -- The engine's row carries the hash it is compared by; a person's does not.
  constraint inspection_repairs_engine_hashed check ((source = 'engine') = (candidates_sha256 is not null)),
  constraint inspection_repairs_accepted_names check ((outcome = 'accepted') = (work_order_fleetpal_id is not null)),
  constraint inspection_repairs_outside_says_where check (
    outcome <> 'repaired_outside_fleetpal' or length(btrim(coalesce(note, ''))) > 0
  )
);

create index if not exists inspection_repairs_unit_idx
  on public.inspection_repairs (org_id, inspection_unit_id, created_at desc);
create index if not exists inspection_repairs_inspection_idx
  on public.inspection_repairs (org_id, inspection_id);

drop trigger if exists trg_inspection_repairs_append_only on public.inspection_repairs;
create trigger trg_inspection_repairs_append_only
  before update or delete on public.inspection_repairs
  for each row execute function public.inspection_evidence_append_only();

alter table public.inspection_repairs enable row level security;

comment on table public.inspection_repairs is
  'IC11 (0482): per inspected unit with a Part 393/396 violation, the FleetPal work orders proposed as its repair (engine) and the one accepted (person), with the 396.9(d) due date. Append-only, service role only.';
