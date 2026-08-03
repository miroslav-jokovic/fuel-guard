-- FuelGuard — 0098 drivers master data (Master Data & Identity, M1 · plan §2.2)
--
-- `drivers` today is a telematics stub: name, phone, employee_id, and the provider ids the sync
-- learned. That is enough to attribute a fuel transaction and nothing like enough to run a fleet —
-- there is no CDL, no medical card, no hire date, no address, no pay terms. This migration turns
-- the stub into MASTER DATA the office owns.
--
-- TWO COLUMNS CARRY THE ARCHITECTURE:
--   identity_source     'samsara' (default — the ~100 rows the sync auto-created) vs 'manual'
--                       (an admin typed it). The sync's UPDATE-on-match path reads this and skips
--                       the identity fields when it is 'manual' — "enrich, never clobber" (§4).
--                       Defaulting to 'samsara' preserves today's behavior for every existing row.
--   app_access_enabled  set true when an invite binds a login to this row (§3.2). Distinct from
--                       `status`: a driver can be active on the roster and have no phone login.
--
-- `full_name` stays canonical and NOT NULL — it is what the sync matches on and what every existing
-- surface renders. first/middle/last are optional structured fields; the CRUD API keeps `full_name`
-- in sync when they are edited, never the reverse.
--
-- No SSN in v1 (decision #4). `date_of_birth` is stored and manager-gated by the section RLS.
-- All statements additive + idempotent; no existing column changes type, nothing is dropped.

-- ── provenance + app access ───────────────────────────────────────────────────
alter table drivers add column if not exists identity_source text not null default 'samsara';
alter table drivers drop constraint if exists drivers_identity_source_check;
alter table drivers add constraint drivers_identity_source_check
  check (identity_source in ('samsara', 'manual'));

alter table drivers add column if not exists app_access_enabled boolean not null default false;

-- ── person ────────────────────────────────────────────────────────────────────
alter table drivers add column if not exists first_name text;
alter table drivers add column if not exists middle_name text;
alter table drivers add column if not exists last_name text;
alter table drivers add column if not exists date_of_birth date;
alter table drivers add column if not exists photo_path text;

-- ── employment ────────────────────────────────────────────────────────────────
alter table drivers add column if not exists hire_date date;
alter table drivers add column if not exists termination_date date;
alter table drivers add column if not exists home_terminal_id uuid references terminals(id) on delete set null;

-- ── contact ───────────────────────────────────────────────────────────────────
alter table drivers add column if not exists email text;
alter table drivers add column if not exists phone_alt text;
alter table drivers add column if not exists address_line1 text;
alter table drivers add column if not exists address_line2 text;
alter table drivers add column if not exists city text;
alter table drivers add column if not exists state text;
alter table drivers add column if not exists postal_code text;
alter table drivers add column if not exists emergency_contact_name text;
alter table drivers add column if not exists emergency_contact_phone text;
alter table drivers add column if not exists emergency_contact_relation text;

-- ── CDL + DOT qualification (the compliance engine's source columns, 0101) ─────
alter table drivers add column if not exists cdl_number text;
alter table drivers add column if not exists cdl_state text;
alter table drivers add column if not exists cdl_class text;
alter table drivers drop constraint if exists drivers_cdl_class_check;
alter table drivers add constraint drivers_cdl_class_check
  check (cdl_class is null or cdl_class in ('A', 'B', 'C'));
alter table drivers add column if not exists cdl_issued_at date;
alter table drivers add column if not exists cdl_expires_at date;
alter table drivers add column if not exists cdl_restrictions text;
alter table drivers add column if not exists medical_card_expires_at date;
alter table drivers add column if not exists medical_examiner_name text;
alter table drivers add column if not exists medical_registry_number text;

-- ── pay (owner-operator attributes only in v1 — decision #5) ──────────────────
alter table drivers add column if not exists pay_type text;
alter table drivers drop constraint if exists drivers_pay_type_check;
alter table drivers add constraint drivers_pay_type_check
  check (pay_type is null or pay_type in ('mileage', 'hourly', 'percentage', 'salary'));
alter table drivers add column if not exists pay_rate numeric(10, 2);
alter table drivers add column if not exists per_diem boolean;
alter table drivers add column if not exists settlement_company text;

-- ── telematics/ELD ────────────────────────────────────────────────────────────
alter table drivers add column if not exists eld_id text;

-- One login ↔ at most one driver. Without this, a bug in the accept flow could bind the same
-- auth user to two roster rows and auth_driver_id() (0083) would return an arbitrary one.
create unique index if not exists idx_drivers_user on drivers(user_id) where user_id is not null;

-- ── endorsements ──────────────────────────────────────────────────────────────
-- Own table rather than a text column: each endorsement carries its OWN expiry (hazmat 'H' renews on
-- a different clock than the CDL), and HazmatGuard's driver-qualification gate reads H/X directly.
create table if not exists driver_endorsements (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  driver_id  uuid not null references drivers(id) on delete cascade,
  /** H hazmat · N tank · X hazmat+tank · T doubles/triples · P passenger · S school bus */
  code       text not null,
  expires_at date,
  created_at timestamptz not null default now(),
  unique (driver_id, code),
  constraint driver_endorsements_code_check check (code in ('H', 'N', 'X', 'T', 'P', 'S'))
);

create index if not exists idx_driver_endorsements_org on driver_endorsements(org_id);
create index if not exists idx_driver_endorsements_driver on driver_endorsements(driver_id);

alter table driver_endorsements enable row level security;

drop policy if exists driver_endorsements_select on driver_endorsements;
create policy driver_endorsements_select on driver_endorsements
  for select using (org_id = auth_org_id());

drop policy if exists driver_endorsements_write on driver_endorsements;
create policy driver_endorsements_write on driver_endorsements
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'safety_manager'));

-- A driver may read their OWN endorsements (the M6 "My profile" screen), nothing else.
-- RESTRICTIVE AND-combines with the org-wide SELECT above, exactly as 0083 does for `drivers`.
drop policy if exists driver_endorsements_driver_scope on driver_endorsements;
create policy driver_endorsements_driver_scope on driver_endorsements
  as restrictive for select
  using (auth_role() <> 'driver' or driver_id = auth_driver_id());

comment on column drivers.identity_source is
  'samsara = telematics-created (sync may overwrite identity fields); manual = admin-owned
   (sync writes only its own columns). Read by samsaraDriverSync — plan §4.';
comment on column drivers.app_access_enabled is
  'True once an invite bound a login to this roster row (invites.driver_id → /accept, plan §3.2).';
