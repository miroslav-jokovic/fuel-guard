-- 0283 — printer calibration for printing onto the pre-printed inspection pads (plan step B5/A8).
--
-- D-AVI8, docs/plans/maintenance/ANNUAL-INSPECTION-PLAN.md. The owner ruled on 2026-08-31 that the
-- copy which rides in the truck is printed onto the J.J. Keller carbonless set, so the values-only
-- render A5 already emits (`background: 'none'`) needs to land inside boxes somebody else printed.
--
-- ── WHY A STORED OFFSET AND NOT A SETTING IN THE BROWSER ────────────────────────────────────────
-- Registration is a property of a PRINTER, not of a person or a session. Two people printing the
-- same report from two machines must get the same page, and the office should not re-measure after
-- clearing their cookies. A row also lets a second printer exist without the first one's offset
-- becoming wrong — which is the whole reason this is a table and not two columns on `organizations`.
--
-- ── WHY IT IS NOT PART OF THE REPORT ────────────────────────────────────────────────────────────
-- Deliberately NOT on `vehicle_inspections`: the offset describes the machine the paper went
-- through, not the inspection. Storing it on the report would make a re-print from a different
-- printer either wrong or a reason to edit a finalized row, and finalized rows do not change
-- (D-AVI4).
--
-- ── THE UNIT IS POINTS, AND POSITIVE MEANS RIGHT AND DOWN ───────────────────────────────────────
-- 72 pt to the inch, matching every other measurement in this feature (the coordinate map, the
-- ruled columns, the page box). A printer that lays ink 2 mm low is corrected with a NEGATIVE y —
-- said here because the sign convention is the one thing a calibration screen can get backwards
-- while looking entirely reasonable.
--
-- Rollback: drop table public.maintenance_print_profiles;

create table if not exists maintenance_print_profiles (
  id           uuid        primary key default gen_random_uuid(),
  org_id       uuid        not null references organizations(id) on delete cascade,
  -- What the office calls the printer, because that is how somebody picks the right one.
  name         text        not null check (length(btrim(name)) between 1 and 80),
  -- Which pre-printed form this offset was measured against. A calibration is only meaningful for
  -- one layout, and a second template later must not silently inherit the first one's numbers.
  layout_key   text        not null default 'jjkeller-14834-rev-1-22' check (length(layout_key) between 1 and 60),
  -- Bounded because a real registration error is millimetres. A ±72 pt (one inch) range is already
  -- far past any misfeed worth correcting, and the bound turns a typo into a refusal rather than
  -- into a page printed an inch off the paper.
  offset_x_pt  numeric(6,2) not null default 0 check (offset_x_pt between -72 and 72),
  offset_y_pt  numeric(6,2) not null default 0 check (offset_y_pt between -72 and 72),
  notes        text        check (length(notes) <= 500),
  created_at   timestamptz not null default now(),
  created_by   uuid        references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint maintenance_print_profiles_name_unique unique (org_id, name)
);

create index if not exists maintenance_print_profiles_org_idx
  on maintenance_print_profiles (org_id, name);

drop trigger if exists trg_maintenance_print_profiles_updated on maintenance_print_profiles;
create trigger trg_maintenance_print_profiles_updated
  before update on maintenance_print_profiles
  for each row execute function set_updated_at();

drop trigger if exists trg_maintenance_print_profiles_org_immutable on maintenance_print_profiles;
create trigger trg_maintenance_print_profiles_org_immutable
  before update on maintenance_print_profiles
  for each row execute function forbid_org_change();

alter table maintenance_print_profiles enable row level security;

-- Role lists derived from the maintenance section, exactly as check-section-policies.mjs requires.
drop policy if exists maintenance_print_profiles_select on maintenance_print_profiles;
create policy maintenance_print_profiles_select on maintenance_print_profiles for select
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician', 'auditor', 'accountant'));
drop policy if exists maintenance_print_profiles_write on maintenance_print_profiles;
create policy maintenance_print_profiles_write on maintenance_print_profiles for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'technician'));

comment on table maintenance_print_profiles is
  'Per-printer registration offset for printing an inspection onto the pre-printed J.J. Keller pad
   (D-AVI8). Points, positive = right and down. Belongs to the printer, not to the report — a
   re-print from another machine uses another profile and the finalized row never changes.';
