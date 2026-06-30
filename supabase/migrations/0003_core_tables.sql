-- FleetGuard — 0003 core tables, triggers & indexes
-- docs/02-DATA-MODEL.md §3 with §10 amendments. Every tenant table carries org_id.

-- ─────────────────────────────────────────────────────────────────────────────
-- organizations
-- ─────────────────────────────────────────────────────────────────────────────
create table organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  allowed_domains text[] not null default '{}',
  operating_hours jsonb not null default '{"start":"05:00","end":"20:00","tz":"America/Chicago"}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_organizations_updated before update on organizations
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- memberships  (auth.users ↔ organization, with a role)
-- ─────────────────────────────────────────────────────────────────────────────
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       user_role not null default 'driver',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_memberships_user on memberships (user_id);
create index idx_memberships_org on memberships (org_id);
create trigger trg_memberships_updated before update on memberships
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- invites
-- ─────────────────────────────────────────────────────────────────────────────
create table invites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  email      text not null,
  role       user_role not null default 'driver',
  status     invite_status not null default 'pending',
  invited_by uuid references auth.users(id),
  token      text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email)
);
create index idx_invites_org on invites (org_id);
create trigger trg_invites_updated before update on invites
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- drivers
-- ─────────────────────────────────────────────────────────────────────────────
create table drivers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid references auth.users(id),
  full_name   text not null,
  employee_id text,
  phone       text,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_drivers_org on drivers (org_id);
create trigger trg_drivers_updated before update on drivers
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- vehicles
-- ─────────────────────────────────────────────────────────────────────────────
create table vehicles (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  unit_number        text not null,
  make               text,
  model              text,
  year               int,
  plate              text,
  vin                text,
  fuel_type          fuel_type not null default 'diesel',
  tank_capacity_gal  numeric(7,2) not null,
  baseline_mpg       numeric(6,2),
  current_odometer   numeric(10,1) not null default 0,   -- derived/advisory (audit B4)
  status             vehicle_status not null default 'active',
  assigned_driver_id uuid references drivers(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, unit_number)
);
create index idx_vehicles_org on vehicles (org_id);
create trigger trg_vehicles_updated before update on vehicles
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- fuel_transactions  (central fact table)
-- ─────────────────────────────────────────────────────────────────────────────
create table fuel_transactions (
  id               uuid primary key default gen_random_uuid(),  -- client-generated UUID (audit H8)
  org_id           uuid not null references organizations(id) on delete cascade,
  vehicle_id       uuid references vehicles(id) on delete restrict,  -- no history loss (audit H5)
  driver_id        uuid references drivers(id) on delete restrict,
  fueled_at        timestamptz not null,
  odometer         numeric(10,1),
  gallons          numeric(8,3) not null,
  price_per_gal    numeric(8,3),
  total_cost       numeric(10,2),
  location_text    text,
  location_lat     numeric(9,6),
  location_lng     numeric(9,6),
  source           text not null default 'manual',   -- manual | import | fuel_card | efs_feed
  receipt_path     text,
  external_ref     text,                              -- provider txn id, idempotency (audit H8)
  -- derived (engine, Phase 5):
  miles_since_last numeric(10,1),
  computed_mpg     numeric(6,2),
  has_anomaly      boolean not null default false,
  max_severity     anomaly_severity,
  ai_risk_level    anomaly_severity,                  -- denormalized latest (docs/07)
  version          int not null default 1,            -- optimistic concurrency (audit H6)
  entered_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index idx_ftxn_org on fuel_transactions (org_id);
create index idx_ftxn_vehicle_time on fuel_transactions (vehicle_id, fueled_at desc);
create index idx_ftxn_org_time on fuel_transactions (org_id, fueled_at desc);
create unique index idx_ftxn_external_ref
  on fuel_transactions (org_id, external_ref) where external_ref is not null;
create trigger trg_ftxn_updated before update on fuel_transactions
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- anomalies
-- ─────────────────────────────────────────────────────────────────────────────
create table anomalies (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  transaction_id  uuid not null references fuel_transactions(id) on delete cascade,
  vehicle_id      uuid references vehicles(id) on delete set null,
  rule_id         text not null,
  severity        anomaly_severity not null,
  status          anomaly_status not null default 'open',
  message         text not null,
  evidence        jsonb not null default '{}',
  source          text not null default 'rules',     -- rules | ml
  assigned_to     uuid references auth.users(id),
  resolved_by     uuid references auth.users(id),
  resolved_at     timestamptz,
  resolution_note text,
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_anomalies_org_status on anomalies (org_id, status);
create index idx_anomalies_txn on anomalies (transaction_id);
create trigger trg_anomalies_updated before update on anomalies
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- anomaly_thresholds  (per-org config, 1 row)
-- ─────────────────────────────────────────────────────────────────────────────
create table anomaly_thresholds (
  org_id                  uuid primary key references organizations(id) on delete cascade,
  mpg_drop_pct            numeric(5,2) not null default 15.0,
  capacity_tolerance_pct  numeric(5,2) not null default 5.0,
  rapid_refuel_hours      int not null default 4,
  max_plausible_mph       numeric(5,1) not null default 85.0,
  cost_min_per_gal        numeric(6,3),
  cost_max_per_gal        numeric(6,3),
  disabled_rules          text[] not null default '{}',      -- opt-out (audit L6)
  ai_verification_enabled boolean not null default true,     -- docs/07
  ai_monthly_token_budget int,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create trigger trg_thresholds_updated before update on anomaly_thresholds
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- audit_logs  (immutable; service-role writes only)
-- ─────────────────────────────────────────────────────────────────────────────
create table audit_logs (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  actor_id   uuid references auth.users(id),
  action     text not null,
  entity     text,
  entity_id  uuid,
  meta       jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index idx_audit_org_time on audit_logs (org_id, created_at desc);
