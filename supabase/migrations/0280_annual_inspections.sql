-- 0280 — the §396.17 annual vehicle inspection: the inspector, the report, its components.
--
-- Plan step A3, docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md (D-AVI4, D-AVI6, D-AVI13). The
-- domain argument lives in packages/shared/src/annualInspectionCatalogue.ts and
-- annualInspectionContract.ts; this file is only the part the database has to be told. Three tables,
-- all owned by the `maintenance` module (docs/ARCHITECTURE.md §4) — its first.
--
-- ── WHY THE REPORT IS A TABLE AND NOT A DOCUMENT ────────────────────────────────────────────────
-- The finished PDF lands in `documents` and its expiry in `certifications`, both of which already
-- accept a tractor or a trailer as a subject and have since 0146/0127 without a single caller. But
-- neither can hold §396.21(a)(5) — "the vehicle components which were inspected and describe the
-- results" — because that is 56 answers with repair dates, and a scan cannot be queried for "which
-- units failed a brake hose this year". So: this table is the event, `certifications` is the
-- expiring fact, `documents` is the page. Three rows, three different questions, recorded in the
-- plan's §2.4 so the next reader does not mistake it for duplication.
--
-- ── APPEND-ONLY BY TRIGGER, NOT BY HOPE (D-AVI4) ────────────────────────────────────────────────
-- A finalized inspection is evidence a DOT auditor may ask for up to fourteen months later
-- (§396.21(b)), so it is frozen the moment it is certified. RLS alone cannot express that — a policy
-- compares a row to a predicate and never OLD to NEW — and the API reads with the service role,
-- which bypasses RLS entirely. Hence a trigger, which is the same argument 0241 made for the
-- identity claim. A correction is a NEW report carrying `supersedes_id`; the superseded row is not
-- touched, and "current" means the newest final report for the subject.
--
-- Deviation from the plan's A3 text, recorded rather than silently taken: the plan allowed the
-- trigger to permit a `supersedes_id` back-reference on the old row. It does not. Supersession is
-- written forward on the new row only, so a final row has NO writable column at all and the rule
-- needs no exception to reason about.
--
-- ── WHY subject_id CARRIES NO FOREIGN KEY ───────────────────────────────────────────────────────
-- Deliberately polymorphic, exactly like `documents.subject_id` (0146): one column addressing either
-- `vehicles` or `trailers`. And a report must OUTLIVE the equipment it describes — a tractor sold in
-- March does not retroactively un-inspect itself in February, and §396.21(b)'s fourteen months are
-- counted from the inspection, not from the fleet's current roster. A cascade would delete evidence
-- as a side effect of a sale, which is precisely what the evidence rules forbid.
--
-- ── ROLE LISTS ARE DERIVED, NOT CHOSEN ──────────────────────────────────────────────────────────
-- Every `auth_role() in (...)` below is exactly rolesThatManage('maintenance') or
-- rolesThatCanView('maintenance') from packages/shared/src/auth.ts, which is what
-- check-section-policies.mjs verifies for any migration above 0260. `technician` is in the manage
-- set because 0279 put it there; if that matrix changes, this gate fails rather than this file
-- quietly meaning something else.
--
-- Rollback: drop table public.vehicle_inspection_items, public.vehicle_inspections,
--           public.maintenance_inspectors; drop function public.forbid_final_inspection_change(),
--           public.forbid_final_inspection_item_change();

-- ── the inspector (§396.19, §396.25) ─────────────────────────────────────────────────────────────
-- The form asserts "THIS INSPECTOR MEETS THE QUALIFICATION REQUIREMENTS IN SECTION 396.19" and on
-- paper that is a tick box. D-AVI6 makes it derived: the assertion is true iff a current row exists
-- here. §396.19(b) gives exactly two ways to qualify and §396.25 adds the brake-specific one, so
-- both are columns rather than prose. The regulation also requires the evidence be retained for the
-- inspector's employment plus one year — which needs a row to hang the document on.
create table if not exists maintenance_inspectors (
  id                   uuid        primary key default gen_random_uuid(),
  org_id               uuid        not null references organizations(id) on delete cascade,
  full_name            text        not null check (length(btrim(full_name)) between 1 and 200),
  -- Printed on the report when the inspection is done by an outside shop. Nullable because an
  -- in-house inspector's address is the carrier's, which the report already carries (plan §6 Q4).
  address              text        check (length(address) <= 400),
  -- Set when the inspector is a Silvicom user (the `technician` role of 0279); null when they are a
  -- name on a third-party shop's paperwork. Nullable on purpose — see plan §6 Q4.
  user_id              uuid        references auth.users(id) on delete set null,
  qualification_basis  text        not null check (qualification_basis in ('state_federal_program', 'training_and_experience')),
  -- §396.25: inspecting brakes is a separate qualification from inspecting a vehicle. Group 1 of the
  -- catalogue is thirteen brake components, so this is not a detail.
  brake_qualified      boolean     not null default false,
  evidence_document_id uuid        references documents(id) on delete set null,
  effective_from       date        not null,
  -- Null while employed. The §396.19(b) retention runs to employment plus one year, and this column
  -- is what a future retention rule would measure from — it must not be repurposed as "deleted".
  effective_to         date,
  notes                text        check (length(notes) <= 2000),
  created_at           timestamptz not null default now(),
  created_by           uuid        references auth.users(id) on delete set null,
  updated_at           timestamptz not null default now(),
  constraint maintenance_inspectors_period check (effective_to is null or effective_to >= effective_from)
);

create index if not exists maintenance_inspectors_org_idx
  on maintenance_inspectors (org_id, effective_to nulls first, full_name);

-- ── the report (§396.21(a)) ──────────────────────────────────────────────────────────────────────
create table if not exists vehicle_inspections (
  -- CLIENT-generated, matching the `documents` and `certifications` pattern: a retried submit
  -- replays onto the same row instead of creating a second report for the same inspection.
  id                            uuid        primary key,
  org_id                        uuid        not null references organizations(id) on delete cascade,
  subject_type                  text        not null check (subject_type in ('tractor', 'trailer')),
  subject_id                    uuid        not null,
  -- restrict, not set null: a report with no inspector fails §396.21(a)(1), so an inspector who has
  -- signed anything cannot be deleted — they are retired with `effective_to` instead.
  inspector_id                  uuid        not null references maintenance_inspectors(id) on delete restrict,
  inspected_on                  date        not null,
  -- Which version of the item catalogue this report was taken under (D-AVI1). Pinned per report so
  -- a 2026 inspection still renders as it was inspected after the catalogue moves.
  catalogue_version             text        not null,
  vehicle_identification_method text        not null default 'vin' check (vehicle_identification_method in ('vin', 'plate', 'other')),
  vehicle_identification_value  text        check (length(vehicle_identification_value) <= 60),
  inspection_agency_location    text        check (length(inspection_agency_location) <= 200),
  -- The serial pre-printed on the carbonless set, when one was used. Unique per org where present
  -- (index below) so one physical form cannot be recorded twice. Plan §6 Q1.
  stock_serial                  text        check (length(stock_serial) <= 40),
  -- The form's group 16: "list any other condition(s) which may prevent safe operation". Free text
  -- with no Appendix A counterpart, so it is a column here and not a catalogue item.
  other_conditions              text        check (length(other_conditions) <= 2000),
  status                        text        not null default 'draft' check (status in ('draft', 'final')),
  -- DERIVED at finalize by deriveInspectionOutcome (D-AVI3) and never typed. Null while draft.
  outcome                       text        check (outcome in ('pass', 'fail')),
  next_due_on                   date,
  supersedes_id                 uuid        references vehicle_inspections(id) on delete set null,
  certification_id              uuid        references certifications(id) on delete set null,
  document_id                   uuid        references documents(id) on delete set null,
  finalized_at                  timestamptz,
  finalized_by                  uuid        references auth.users(id) on delete set null,
  created_at                    timestamptz not null default now(),
  created_by                    uuid        references auth.users(id) on delete set null,
  updated_at                    timestamptz not null default now(),
  -- A draft has no verdict and a final report has all of one. Enforced here rather than in the
  -- service because "final but outcome null" is a report that certifies nothing while looking
  -- certified, and that state must not be reachable by any writer including the service role.
  constraint vehicle_inspections_shape check (
    (status = 'draft' and outcome is null and next_due_on is null and finalized_at is null)
    or
    (status = 'final' and outcome is not null and next_due_on is not null and finalized_at is not null)
  ),
  constraint vehicle_inspections_due_after check (next_due_on is null or next_due_on > inspected_on)
);

-- "The inspections for this truck, newest first" — the list, the detail page and the expiry lookup.
create index if not exists vehicle_inspections_subject_idx
  on vehicle_inspections (org_id, subject_type, subject_id, inspected_on desc);
create index if not exists vehicle_inspections_org_status_idx
  on vehicle_inspections (org_id, status, inspected_on desc);
create unique index if not exists vehicle_inspections_stock_serial_idx
  on vehicle_inspections (org_id, stock_serial) where stock_serial is not null;

-- ── the components (§396.21(a)(5)) ───────────────────────────────────────────────────────────────
-- One row per catalogue item per report. Rows rather than a JSON blob because the questions a
-- maintenance manager actually asks are per-component — "which units failed a brake hose this
-- year", "how often does group 10 come back" — and because a repair date belongs to a component,
-- not to a report.
create table if not exists vehicle_inspection_items (
  id            uuid        primary key default gen_random_uuid(),
  org_id        uuid        not null references organizations(id) on delete cascade,
  inspection_id uuid        not null references vehicle_inspections(id) on delete cascade,
  -- The catalogue key (`brake.service_brakes`). Deliberately not an enum: the catalogue is versioned
  -- application data and a report pins the version it used, so the database must be able to hold a
  -- key that a later catalogue no longer offers.
  item_key      text        not null check (length(btrim(item_key)) between 1 and 80),
  result        text        not null check (result in ('ok', 'needs_repair', 'na')),
  -- D-AVI13's one-column cost. The web form opens pre-filled from the catalogue, so without this the
  -- record cannot distinguish a component the inspector looked at from one that carried its default
  -- through. It changes no screen and slows nobody down.
  source        text        not null default 'default' check (source in ('default', 'inspector')),
  repaired_at   date,
  note          text        check (length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint vehicle_inspection_items_unique unique (inspection_id, item_key),
  -- A repair date on a component that did not need repair is a data-entry error, not a fact.
  constraint vehicle_inspection_items_repair_date check (repaired_at is null or result = 'needs_repair')
);

create index if not exists vehicle_inspection_items_inspection_idx
  on vehicle_inspection_items (inspection_id);
-- "Which units failed this component" — the query the whole row-per-item shape exists for.
create index if not exists vehicle_inspection_items_defects_idx
  on vehicle_inspection_items (org_id, item_key) where result = 'needs_repair';

-- ── immutability (D-AVI4) ────────────────────────────────────────────────────────────────────────
create or replace function public.forbid_final_inspection_change()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'vehicle_inspections %: a finalized §396.17 report is evidence and cannot be edited — record a new inspection with supersedes_id set',
    old.id
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.forbid_final_inspection_change() is
  'D-AVI4: a finalized annual inspection is append-only. RLS cannot express OLD vs NEW and the API
   reads with the service role which bypasses RLS, so the rule lives in a trigger — the same
   argument 0241 made for the identity claim. Corrections are new rows carrying supersedes_id.';

-- WHEN, not an IF inside the body: the trigger does not fire at all for a draft, so the ordinary
-- editing path pays nothing for a rule that only concerns certified rows.
drop trigger if exists trg_vehicle_inspections_final_immutable on vehicle_inspections;
create trigger trg_vehicle_inspections_final_immutable
  before update on vehicle_inspections
  for each row when (old.status = 'final')
  execute function public.forbid_final_inspection_change();

-- The components of a certified report are equally frozen; editing them would change what the
-- report says without touching the report.
--
-- ⚠ The parent lookup lives in the FUNCTION BODY and not in a `when` clause, because Postgres
-- rejects a subquery in a trigger WHEN condition outright ("cannot use subquery in trigger WHEN
-- condition"). Found by supabase/tests/annual-inspections.test.mjs on the first run, which is the
-- argument for the matrix existing: the migration was well-formed SQL that simply cannot be
-- installed, and nothing short of applying it would have said so.
create or replace function public.forbid_final_inspection_item_change()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.vehicle_inspections i where i.id = old.inspection_id and i.status = 'final') then
    raise exception
      'vehicle_inspection_items %: the components of a finalized §396.17 report are evidence and cannot be edited — record a new inspection with supersedes_id set',
      old.id
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

comment on function public.forbid_final_inspection_item_change() is
  'D-AVI4, the per-component half. Same rule as forbid_final_inspection_change(), but the parent
   lookup must sit in the body — Postgres forbids a subquery in a trigger WHEN clause.';

drop trigger if exists trg_vehicle_inspection_items_final_immutable on vehicle_inspection_items;
create trigger trg_vehicle_inspection_items_final_immutable
  before update on vehicle_inspection_items
  for each row execute function public.forbid_final_inspection_item_change();

-- A row cannot be walked into another tenant by an update (0161's invariant).
drop trigger if exists trg_maintenance_inspectors_org_immutable on maintenance_inspectors;
create trigger trg_maintenance_inspectors_org_immutable
  before update on maintenance_inspectors
  for each row execute function forbid_org_change();
drop trigger if exists trg_vehicle_inspections_org_immutable on vehicle_inspections;
create trigger trg_vehicle_inspections_org_immutable
  before update on vehicle_inspections
  for each row execute function forbid_org_change();
drop trigger if exists trg_vehicle_inspection_items_org_immutable on vehicle_inspection_items;
create trigger trg_vehicle_inspection_items_org_immutable
  before update on vehicle_inspection_items
  for each row execute function forbid_org_change();

drop trigger if exists trg_maintenance_inspectors_updated on maintenance_inspectors;
create trigger trg_maintenance_inspectors_updated
  before update on maintenance_inspectors
  for each row execute function set_updated_at();
drop trigger if exists trg_vehicle_inspections_updated on vehicle_inspections;
create trigger trg_vehicle_inspections_updated
  before update on vehicle_inspections
  for each row execute function set_updated_at();
drop trigger if exists trg_vehicle_inspection_items_updated on vehicle_inspection_items;
create trigger trg_vehicle_inspection_items_updated
  before update on vehicle_inspection_items
  for each row execute function set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────
alter table maintenance_inspectors     enable row level security;
alter table vehicle_inspections        enable row level security;
alter table vehicle_inspection_items   enable row level security;

-- Read: rolesThatCanView('maintenance'). The accountant and the auditor are in it because the
-- repair-spend ledger and a DOT audit are both legitimate readers of what was inspected and when.
drop policy if exists maintenance_inspectors_select on maintenance_inspectors;
create policy maintenance_inspectors_select on maintenance_inspectors for select
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician', 'auditor', 'accountant'));
drop policy if exists vehicle_inspections_select on vehicle_inspections;
create policy vehicle_inspections_select on vehicle_inspections for select
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician', 'auditor', 'accountant'));
drop policy if exists vehicle_inspection_items_select on vehicle_inspection_items;
create policy vehicle_inspection_items_select on vehicle_inspection_items for select
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician', 'auditor', 'accountant'));

-- Write: rolesThatManage('maintenance'). No DELETE policy anywhere, deliberately — removing an
-- inspection is not something a client does. The trigger above is what stops the service role
-- editing a certified one.
drop policy if exists maintenance_inspectors_write on maintenance_inspectors;
create policy maintenance_inspectors_write on maintenance_inspectors for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'));
drop policy if exists vehicle_inspections_write on vehicle_inspections;
create policy vehicle_inspections_write on vehicle_inspections for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'));
drop policy if exists vehicle_inspection_items_write on vehicle_inspection_items;
create policy vehicle_inspection_items_write on vehicle_inspection_items for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'));

comment on table maintenance_inspectors is
  'Who may perform a §396.17 inspection and on what §396.19(b)/§396.25 basis (D-AVI6). The form''s
   qualification assertion is derived from a current row here, never typed.';
comment on table vehicle_inspections is
  'One §396.17 annual inspection report. Append-only once final (D-AVI4); the PDF lives in documents
   and the expiry in certifications — see the plan''s §2.4 for why all three exist.';
comment on table vehicle_inspection_items is
  'The §396.21(a)(5) per-component results for one report, keyed by the versioned Appendix A
   catalogue in packages/shared/src/annualInspectionCatalogue.ts.';
