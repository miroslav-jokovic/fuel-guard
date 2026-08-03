-- FuelGuard — 0099 tractors master data (Master Data & Identity, M1 · plan §2.3)
--
-- `vehicles` is already rich on the TELEMATICS axis — fuel level, odometer offsets, idle capability,
-- tank calibration, physical dimensions. What it has never had is the OFFICE axis: who owns the
-- truck, what it cost, who holds the lien, when the registration and the annual DOT inspection
-- expire, when the next PM is due.
--
-- Same provenance flag as drivers: `identity_source` defaults to 'samsara' so every existing
-- synced row keeps today's behavior, and flips to 'manual' the moment an admin edits the vehicle
-- through the roster API — after which samsaraVehicleSync stops overwriting make/model/year/plate/vin
-- and writes only its own columns (plan §4).
--
-- Maintenance is deliberately TWO fields, not a module (decision #6): next_pm_due_odometer and
-- next_pm_due_at answer "is this truck due?" without pretending to be a shop system.
--
-- Additive + idempotent. No existing column changes.

-- ── provenance ────────────────────────────────────────────────────────────────
alter table vehicles add column if not exists identity_source text not null default 'samsara';
alter table vehicles drop constraint if exists vehicles_identity_source_check;
alter table vehicles add constraint vehicles_identity_source_check
  check (identity_source in ('samsara', 'manual'));

-- ── ownership + finance ───────────────────────────────────────────────────────
alter table vehicles add column if not exists ownership_type text;
alter table vehicles drop constraint if exists vehicles_ownership_type_check;
alter table vehicles add constraint vehicles_ownership_type_check
  check (ownership_type is null or ownership_type in ('owned', 'leased', 'owner_operator'));
/** The owner-operator who owns this tractor — distinct from assigned_driver_id (who drives it). */
alter table vehicles add column if not exists owner_driver_id uuid references drivers(id) on delete set null;
alter table vehicles add column if not exists purchased_at date;
alter table vehicles add column if not exists purchase_cost numeric(12, 2);
alter table vehicles add column if not exists lienholder text;
alter table vehicles add column if not exists title_number text;

-- ── registration / regulatory (compliance engine source columns, 0101) ────────
alter table vehicles add column if not exists plate_state text;
alter table vehicles add column if not exists registration_expires_at date;
alter table vehicles add column if not exists irp_account text;
alter table vehicles add column if not exists ifta_account text;
alter table vehicles add column if not exists insurance_carrier text;
alter table vehicles add column if not exists insurance_policy text;
alter table vehicles add column if not exists insurance_expires_at date;
alter table vehicles add column if not exists dot_annual_inspection_expires_at date;

-- ── maintenance (two fields, not a module — decision #6) ──────────────────────
alter table vehicles add column if not exists next_pm_due_odometer numeric(10, 1);
alter table vehicles add column if not exists next_pm_due_at date;

-- ── spec ──────────────────────────────────────────────────────────────────────
alter table vehicles add column if not exists engine_make text;
alter table vehicles add column if not exists engine_model text;
alter table vehicles add column if not exists horsepower int;
alter table vehicles add column if not exists transmission text;
alter table vehicles add column if not exists gvwr_lb numeric;
alter table vehicles add column if not exists sleeper boolean;

-- ── assignment / ELD ──────────────────────────────────────────────────────────
alter table vehicles add column if not exists home_terminal_id uuid references terminals(id) on delete set null;
alter table vehicles add column if not exists eld_id text;

create index if not exists idx_vehicles_owner_driver on vehicles(owner_driver_id) where owner_driver_id is not null;

comment on column vehicles.identity_source is
  'samsara = telematics-created (sync may overwrite make/model/year/plate/vin); manual = admin-owned
   (sync writes only odometer/fuel/idle/samsara_vehicle_id). Read by samsaraVehicleSync — plan §4.';
comment on column vehicles.owner_driver_id is
  'Owner-operator who OWNS this tractor. assigned_driver_id is who DRIVES it — usually but not always
   the same person.';
