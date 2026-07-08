-- FuelGuard — idempotent schema reconcile (migrations 0010 → 0032)
-- Safe to run on a database that had migrations applied piecemeal. Every statement uses IF [NOT] EXISTS
-- (or drop-then-create), so running it when things already exist is a harmless no-op. Fixes uploads/sync
-- and page loads failing with "column ... does not exist" (e.g. vehicles.odometer_offset) or on-conflict
-- arbiter errors.
--
-- SCOPE: SCHEMA ONLY (columns, tables, indexes, RLS policies). It intentionally OMITS the one-shot DATA
-- conversions in migration 0026 (the timezone shift + dedupe-key rewrite) — those must never be re-run
-- (a second run would double-shift timestamps) and are unrelated to the missing-column errors.

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

-- ── 0016: driver Samsara uniqueness + vehicle current fuel level ─────────────────────────────
create unique index if not exists idx_drivers_samsara_id
  on drivers (org_id, samsara_driver_id) where samsara_driver_id is not null;
alter table vehicles add column if not exists samsara_fuel_percent numeric(5,1);  -- 0..100 (%)
alter table vehicles add column if not exists samsara_fuel_at      timestamptz;

-- ── 0017: imports.file_hash (re-upload detection) ────────────────────────────────────────────
alter table imports add column if not exists file_hash text;
create index if not exists idx_imports_file_hash on imports (org_id, file_hash) where file_hash is not null;

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

-- tries, or a decline followed by an approval elsewhere). Store a suspicion assessment on each decline.
alter table declined_transactions add column if not exists suspicion_level            text;   -- clear | review | alert
alter table declined_transactions add column if not exists suspicion_reasons          jsonb not null default '[]';
alter table declined_transactions add column if not exists samsara_location_matched   boolean;
alter table declined_transactions add column if not exists samsara_location_confidence text;   -- gps_confirmed | in_state | mismatch | unknown
alter table declined_transactions add column if not exists station_lat                numeric(9,6);
alter table declined_transactions add column if not exists station_lng                numeric(9,6);
alter table declined_transactions add column if not exists scored_at                  timestamptz;
create index if not exists idx_declined_suspicion on declined_transactions (org_id, suspicion_level);

alter table anomalies add column if not exists fueled_at timestamptz;
create index if not exists idx_anomaly_org_fueled on anomalies (org_id, fueled_at desc);

-- Backfill existing rows from their transaction (safe to re-run).
update anomalies a
set fueled_at = t.fueled_at
from fuel_transactions t
where a.transaction_id = t.id and a.fueled_at is null;

-- ── 0024: weekly digest bookkeeping ──────────────────────────────────────────────────────────
alter table organizations add column if not exists last_digest_at timestamptz;

-- ── 0025: per-vehicle odometer offset (dash ↔ Samsara calibration) ───────────────────────────
-- Learned constant (entered − samsara) subtracted before the odometer_mismatch check, so trucks
-- whose dash sits a fixed amount off OBD stop false-flagging. source='manual' pins a human override.
alter table vehicles add column if not exists odometer_offset        numeric(10,1) not null default 0;
alter table vehicles add column if not exists odometer_offset_source text          not null default 'auto';

-- ── 0026: data-reliability SCHEMA bits (one-shot DATA conversions intentionally OMITTED — see header) ─
alter table fuel_transactions add column if not exists fueled_at_precision text
  check (fueled_at_precision in ('instant', 'date'));
update fuel_transactions set fueled_at_precision = 'instant' where fueled_at_precision is null; -- safe default
alter table fuel_transactions alter column fueled_at_precision set default 'instant';
alter table fuel_transactions alter column fueled_at_precision set not null;
alter table anomaly_thresholds alter column odometer_tolerance_miles set default 10;  -- was 5 in 0010
alter table imports add column if not exists summary jsonb;
alter table geocode_cache add column if not exists updated_at timestamptz not null default now();
create table if not exists migration_markers (key text primary key, done_at timestamptz not null default now());
alter table migration_markers enable row level security;
-- NOTE: the '0026_tz_shift' marker is NOT inserted here — this reconcile does not run that data step.

-- ── 0027: background job ledger (sync / rebuild / backfill / reconcile progress + freshness) ──────
create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  kind          text not null,
  status        text not null default 'queued',
  progress      int  not null default 0,
  total         int,
  error         text,
  stats         jsonb not null default '{}',
  requested_by  uuid,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_jobs_org_kind_created on jobs (org_id, kind, created_at desc);
create unique index if not exists idx_jobs_active_one on jobs (org_id, kind) where status in ('queued', 'running');
alter table jobs enable row level security;
drop policy if exists jobs_select on jobs;
create policy jobs_select on jobs for select using (org_id = auth_org_id());

-- ── 0028: tank-rise fueling-event outputs (observed location, post-fill level, time-basis) ────────
alter table fuel_transactions add column if not exists samsara_observed_state   text;
alter table fuel_transactions add column if not exists samsara_observed_city    text;
alter table fuel_transactions add column if not exists samsara_observed_address text;
alter table fuel_transactions add column if not exists samsara_observed_lat     numeric(9,6);
alter table fuel_transactions add column if not exists samsara_observed_lng     numeric(9,6);
alter table fuel_transactions add column if not exists samsara_fuel_pct_after   numeric(5,1);
alter table fuel_transactions add column if not exists fueling_time_basis       text;

-- ── 0029: reefer/tractor tank split ──────────────────────────────────────────────────────────────
alter table fuel_transactions add column if not exists tank_type text not null default 'tractor';
create index if not exists idx_ftxn_vehicle_tank on fuel_transactions (org_id, vehicle_id, tank_type, fueled_at desc);

-- ── 0030: trailers (reefer) reference table ────────────────────────────────────────────────────────
create table if not exists trailers (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  unit_number              text not null,
  make                     text,
  model                    text,
  year                     int,
  plate                    text,
  reefer_tank_capacity_gal numeric(7,2) not null default 50,
  status                   text not null default 'active',
  assigned_vehicle_id      uuid references vehicles(id) on delete set null,
  samsara_asset_id         text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
-- ── 0031: reefer detection thresholds ──────────────────────────────────────────────────────────────
alter table anomaly_thresholds add column if not exists max_reefer_burn_gph     numeric(5,2) not null default 1.5;
alter table anomaly_thresholds add column if not exists reefer_tank_default_gal numeric(7,2) not null default 50;

create unique index if not exists idx_trailers_org_unit on trailers (org_id, unit_number);
create index  if not exists idx_trailers_org_status on trailers (org_id, status);
alter table trailers enable row level security;
drop policy if exists trailers_select on trailers;
create policy trailers_select on trailers for select using (org_id = auth_org_id());
drop policy if exists trailers_write on trailers;
create policy trailers_write on trailers for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── 0032: explicit reefer flag (not every trailer is refrigerated) ───────────────────────────────────
alter table trailers add column if not exists is_reefer boolean not null default false;
create index if not exists idx_trailers_org_reefer on trailers (org_id, is_reefer);

-- ── 0033: Samsara odometer reading time (physical-fill anchor) ───────────────────────────────────────
alter table fuel_transactions add column if not exists samsara_odometer_at timestamptz;

-- ── 0034: reviewer ground-truth disposition on cases (accuracy metrics) ──────────────────────────────
alter table anomalies add column if not exists disposition    text
  check (disposition in ('confirmed', 'false_positive', 'benign_explained', 'inconclusive'));
alter table anomalies add column if not exists disposition_by  uuid references auth.users(id);
alter table anomalies add column if not exists disposition_at  timestamptz;
create index if not exists idx_anomalies_disposition on anomalies (org_id, disposition, fueled_at desc)
  where disposition is not null;
