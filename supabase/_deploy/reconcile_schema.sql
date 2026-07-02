-- FuelGuard — idempotent schema reconcile (migrations 0010 → 0015)
-- Safe to run once on a database that had migrations applied piecemeal. Every statement uses
-- IF [NOT] EXISTS (or drop-then-create), so running it when things already exist is a harmless no-op.
-- Fixes uploads/sync failing with 400 "column ... does not exist" or the on-conflict arbiter error.

-- ── 0010: card identity + tuning thresholds + idempotency index ─────────────────────────────
alter table fuel_transactions add column if not exists card_ref text;
create index if not exists idx_ftxn_card on fuel_transactions (org_id, card_ref, fueled_at desc);

create unique index if not exists idx_anomaly_active_rule
  on anomalies (transaction_id, rule_id) where status <> 'superseded';

alter table anomaly_thresholds add column if not exists odometer_tolerance_miles numeric(6,1) not null default 5;
alter table anomaly_thresholds add column if not exists max_daily_miles          int          not null default 1000;
alter table anomaly_thresholds add column if not exists cumulative_window_hours  int          not null default 48;

-- ── 0011: faithful EFS storage + reject columns ─────────────────────────────────────────────
create table if not exists efs_transactions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  import_id     uuid references imports(id) on delete set null,
  line_number   int,
  external_ref  text,
  card_num      text,
  tran_date     date,
  fueled_at     timestamptz,
  invoice       text,
  unit          text,
  driver_name   text,
  odometer      numeric(10,1),
  location_name text,
  city          text,
  state         text,
  fees          numeric(10,2),
  item          text,
  unit_price    numeric(10,3),
  qty           numeric(12,3),
  amt           numeric(12,2),
  db            text,
  currency      text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_efs_txn_org_date on efs_transactions (org_id, tran_date desc);
create index if not exists idx_efs_txn_org_unit on efs_transactions (org_id, unit, tran_date desc);
alter table efs_transactions enable row level security;
drop policy if exists efs_txn_select on efs_transactions;
create policy efs_txn_select on efs_transactions for select using (org_id = auth_org_id());
drop policy if exists efs_txn_write on efs_transactions;
create policy efs_txn_write on efs_transactions for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

alter table declined_transactions add column if not exists location_id text;
alter table declined_transactions add column if not exists driver_name text;
alter table declined_transactions add column if not exists policy text;
alter table declined_transactions add column if not exists policy_name text;

-- ── 0012: Samsara mapping + creds + reconciliation columns ──────────────────────────────────
alter table vehicles add column if not exists samsara_vehicle_id text;

create table if not exists integration_credentials (
  org_id            uuid primary key references organizations(id) on delete cascade,
  provider          text not null default 'samsara',
  samsara_api_token text,
  enabled           boolean not null default true,
  last_synced_at    timestamptz,
  updated_at        timestamptz not null default now()
);
alter table integration_credentials enable row level security;

alter table fuel_transactions add column if not exists city  text;
alter table fuel_transactions add column if not exists state text;
alter table fuel_transactions add column if not exists samsara_odometer         numeric(10,1);
alter table fuel_transactions add column if not exists samsara_location_matched boolean;
alter table fuel_transactions add column if not exists samsara_recon_at         timestamptz;

-- ── 0013: tank-fill reconciliation columns ──────────────────────────────────────────────────
alter table fuel_transactions add column if not exists samsara_tank_observed_gal numeric(10,1);
alter table fuel_transactions add column if not exists samsara_tank_short_gal    numeric(10,1);

-- ── 0014: upsert-safe FULL unique indexes (partial index can't be an ON CONFLICT arbiter) ───
drop index if exists idx_ftxn_external_ref;
create unique index if not exists idx_ftxn_external_ref on fuel_transactions (org_id, external_ref);
drop index if exists idx_declined_external_ref;
create unique index if not exists idx_declined_external_ref on declined_transactions (org_id, external_ref);
drop index if exists idx_efs_txn_extref;
create unique index if not exists idx_efs_txn_extref on efs_transactions (org_id, external_ref);

-- ── 0015: driver ↔ Samsara mapping ──────────────────────────────────────────────────────────
alter table drivers add column if not exists samsara_driver_id text;

-- ── 0018: geocoding cache + location confidence ─────────────────────────────────────────────
create table if not exists geocode_cache (
  query      text primary key,
  lat        numeric(9,6),
  lng        numeric(9,6),
  resolved   boolean not null default false,
  provider   text,
  created_at timestamptz not null default now()
);
alter table geocode_cache enable row level security;
alter table fuel_transactions add column if not exists samsara_location_confidence text;
alter table fuel_transactions add column if not exists station_lat numeric(9,6);
alter table fuel_transactions add column if not exists station_lng numeric(9,6);

-- ── 0019: geocode precision ─────────────────────────────────────────────────────────────────
alter table geocode_cache add column if not exists precision text;

-- ── 0020: pre-fill tank level ────────────────────────────────────────────────────────────────
alter table fuel_transactions add column if not exists samsara_fuel_pct_before numeric(5,1);
-- is fuel LEAVING the tank with no purchase — a direct theft signal independent of the card feed.
create table if not exists fuel_events (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  vehicle_id         uuid references vehicles(id) on delete set null,
  samsara_vehicle_id text,
  event_type         text not null default 'fuel_drop',   -- fuel_drop | fuel_rise
  happened_at        timestamptz not null,
  drop_pct           numeric(5,1),                         -- magnitude of the drop, %
  fuel_pct_before    numeric(5,1),
  fuel_pct_after     numeric(5,1),
  lat                numeric(9,6),
  lng                numeric(9,6),
  address            text,
  external_ref       text,                                 -- Samsara eventId (idempotent re-delivery)
  raw                jsonb not null default '{}',
  created_at         timestamptz not null default now()
);
create unique index if not exists idx_fuel_events_extref on fuel_events (org_id, external_ref) where external_ref is not null;
create index if not exists idx_fuel_events_org_time on fuel_events (org_id, happened_at desc);

-- RLS: read = org members; writes are service-role only (the webhook handler performs them).
alter table fuel_events enable row level security;
drop policy if exists fuel_events_select on fuel_events;
create policy fuel_events_select on fuel_events for select using (org_id = auth_org_id());

