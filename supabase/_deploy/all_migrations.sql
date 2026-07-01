-- FuelGuard — ALL migrations combined (0001 → 0013), in order.
-- Paste this whole file into the Supabase SQL Editor once and Run. Generated from
-- supabase/migrations/*.sql — keep that folder as the source of truth; regenerate if it changes.
-- (For ongoing/automated migrations use the Supabase CLI 'db push' or the GitHub Action instead.)


-- ============================================================================
-- 0001_extensions_and_enums.sql
-- ============================================================================
-- FuelGuard — 0001 extensions & enums
-- Mirrors docs/02-DATA-MODEL.md §2 (with §10 v1.1 amendments).

-- pgcrypto provides gen_random_uuid() on older Postgres; harmless on newer.
create extension if not exists pgcrypto;

create type user_role        as enum ('admin', 'fleet_manager', 'driver', 'auditor');
create type fuel_type        as enum ('diesel', 'gasoline', 'def', 'electric', 'other');
create type vehicle_status   as enum ('active', 'maintenance', 'retired');
create type anomaly_status   as enum ('open', 'investigating', 'resolved', 'dismissed', 'superseded');
create type anomaly_severity as enum ('low', 'medium', 'high', 'critical');
create type invite_status    as enum ('pending', 'accepted', 'revoked', 'expired');


-- ============================================================================
-- 0002_functions.sql
-- ============================================================================
-- FuelGuard — 0002 helper functions & triggers
-- docs/02-DATA-MODEL.md §4 and §10.1

-- Maintains updated_at on any table that has the column.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Tenant id from the JWT claim injected by the Custom Access Token hook (docs/01 §4).
-- Returns null when no claim is present (e.g. a user with no membership yet → RLS denies).
create or replace function auth_org_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'org_id', '')::uuid;
$$;

-- App role from the JWT claim. NB: we use `user_role` (not `role`) because Supabase reserves the
-- `role` claim for the Postgres DB role (authenticated/anon) — overwriting it breaks auth. The
-- Custom Access Token hook (0006) injects `user_role` from the user's membership.
create or replace function auth_role()
returns text
language sql
stable
as $$
  select current_setting('request.jwt.claims', true)::jsonb ->> 'user_role';
$$;


-- ============================================================================
-- 0003_core_tables.sql
-- ============================================================================
-- FuelGuard — 0003 core tables, triggers & indexes
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


-- ============================================================================
-- 0004_rls.sql
-- ============================================================================
-- FuelGuard — 0004 Row Level Security
-- docs/02-DATA-MODEL.md §5 (+ §10). RLS is MANDATORY: every table is enabled with policies.
-- The Supabase service_role key has BYPASSRLS and is used only by the API for engine/audit/import
-- writes AFTER its own auth+ownership checks (audit B5). Policies below govern normal user JWTs.

-- ── organizations ────────────────────────────────────────────────────────────
alter table organizations enable row level security;

create policy organizations_select on organizations
  for select using (id = auth_org_id());

create policy organizations_update on organizations
  for update using (id = auth_org_id() and auth_role() = 'admin')
  with check (id = auth_org_id() and auth_role() = 'admin');

-- ── memberships ──────────────────────────────────────────────────────────────
alter table memberships enable row level security;

create policy memberships_select on memberships
  for select using (org_id = auth_org_id());

create policy memberships_write on memberships
  for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- ── invites ──────────────────────────────────────────────────────────────────
alter table invites enable row level security;

create policy invites_admin_all on invites
  for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- ── drivers ──────────────────────────────────────────────────────────────────
alter table drivers enable row level security;

create policy drivers_select on drivers
  for select using (org_id = auth_org_id());

create policy drivers_write on drivers
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── vehicles ─────────────────────────────────────────────────────────────────
alter table vehicles enable row level security;

create policy vehicles_select on vehicles
  for select using (org_id = auth_org_id());

create policy vehicles_write on vehicles
  for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── fuel_transactions ────────────────────────────────────────────────────────
alter table fuel_transactions enable row level security;

create policy ftxn_select on fuel_transactions
  for select using (org_id = auth_org_id());

-- Drivers may log fill-ups; managers/admins too.
create policy ftxn_insert on fuel_transactions
  for insert
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager', 'driver'));

-- Edits/deletes are manager/admin only.
create policy ftxn_update on fuel_transactions
  for update
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

create policy ftxn_delete on fuel_transactions
  for delete
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── anomalies ────────────────────────────────────────────────────────────────
-- Engine inserts/deletes via service role (bypasses RLS). Users read; managers triage (update).
alter table anomalies enable row level security;

create policy anomalies_select on anomalies
  for select using (org_id = auth_org_id());

create policy anomalies_update on anomalies
  for update
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- ── anomaly_thresholds ───────────────────────────────────────────────────────
alter table anomaly_thresholds enable row level security;

create policy thresholds_select on anomaly_thresholds
  for select using (org_id = auth_org_id());

create policy thresholds_write on anomaly_thresholds
  for all
  using (org_id = auth_org_id() and auth_role() = 'admin')
  with check (org_id = auth_org_id() and auth_role() = 'admin');

-- ── audit_logs ───────────────────────────────────────────────────────────────
-- Read by admin + auditor; no client writes (service role only).
alter table audit_logs enable row level security;

create policy audit_select on audit_logs
  for select using (org_id = auth_org_id() and auth_role() in ('admin', 'auditor'));


-- ============================================================================
-- 0005_storage.sql
-- ============================================================================
-- FuelGuard — 0005 storage (receipt photos)
-- docs/01-ARCHITECTURE.md §6, docs/02 §10.9. Private bucket; objects keyed org_id/vehicle_id/{uuid}.
-- Tenant isolation mirrors the DB: a user may only touch objects under their own org_id prefix.

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy receipts_read on storage.objects
  for select
  using (bucket_id = 'receipts' and split_part(name, '/', 1) = auth_org_id()::text);

create policy receipts_insert on storage.objects
  for insert
  with check (bucket_id = 'receipts' and split_part(name, '/', 1) = auth_org_id()::text);

create policy receipts_delete on storage.objects
  for delete
  using (bucket_id = 'receipts' and split_part(name, '/', 1) = auth_org_id()::text);


-- ============================================================================
-- 0006_auth_hook.sql
-- ============================================================================
-- FuelGuard — 0006 Custom Access Token hook
-- docs/01-ARCHITECTURE.md §4. Injects org_id + user_role from the user's membership into the JWT,
-- so RLS (auth_org_id()/auth_role()) can authorize. Runs before each token is issued.
--
-- IMPORTANT: we inject `user_role` (NOT `role`). Supabase reserves the `role` claim for the
-- Postgres DB role (authenticated/anon); overwriting it breaks auth (audit B1/B3 follow-through).
-- If the user has no membership yet, NO org claim is added → the app shows "account pending" and
-- RLS denies tenant data (the correct, safe default — audit B3).
--
-- After applying, enable it in the Dashboard: Authentication → Hooks → Custom Access Token →
-- select public.custom_access_token_hook. For local dev, add to supabase/config.toml:
--   [auth.hook.custom_access_token]
--   enabled = true
--   uri = "pg-functions://postgres/public/custom_access_token_hook"

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  claims  jsonb;
  v_org   uuid;
  v_role  text;
begin
  -- A user belongs to exactly one org in v1 (audit M1); pick the earliest membership defensively.
  select m.org_id, m.role::text
    into v_org, v_role
  from public.memberships m
  where m.user_id = (event->>'user_id')::uuid
  order by m.created_at asc
  limit 1;

  claims := coalesce(event->'claims', '{}'::jsonb);

  if v_org is not null then
    claims := jsonb_set(claims, '{org_id}', to_jsonb(v_org::text));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Only the Auth server may execute the hook; never expose it to the Data API.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- Let the Auth admin read memberships (belt-and-suspenders; the function is SECURITY DEFINER).
grant select on public.memberships to supabase_auth_admin;
create policy memberships_auth_admin_read on public.memberships
  for select to supabase_auth_admin using (true);


-- ============================================================================
-- 0007_imports.sql
-- ============================================================================
-- FuelGuard — 0007 fuel-card import tables
-- docs/08-EFS-INTEGRATION.md §3, §3.1. One staging→reconcile→commit pipeline for XLSX/CSV uploads
-- (Transaction Report → fuel_transactions; Reject Report → declined_transactions). The EFS feed
-- (Phase 10) reuses these tables. fuel_transactions.external_ref + its unique index already exist
-- (migration 0003); here we only add import_id and the new tables.

create type import_source as enum ('xlsx', 'csv', 'efs_feed', 'corpay_feed');
create type import_kind   as enum ('transaction', 'reject');
create type import_status as enum ('uploaded', 'parsing', 'review', 'committing', 'completed', 'failed');
create type row_status    as enum ('pending', 'valid', 'duplicate', 'unattributed', 'skipped', 'error', 'committed');

-- ── fuel_cards: map a physical card to a vehicle/driver ──────────────────────
create table fuel_cards (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  card_ref          text not null,                 -- EFS "Card #" or full PAN
  card_last4        text,
  provider          text not null default 'efs',
  vehicle_id        uuid references vehicles(id) on delete set null,
  driver_id         uuid references drivers(id) on delete set null,
  status            text not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, provider, card_ref)
);
create index idx_fuel_cards_org on fuel_cards (org_id);
create trigger trg_fuel_cards_updated before update on fuel_cards
  for each row execute function set_updated_at();

-- ── imports: one uploaded file (or feed pull) ────────────────────────────────
create table imports (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  source          import_source not null,
  kind            import_kind not null,
  filename        text,
  status          import_status not null default 'uploaded',
  total_rows      int not null default 0,
  inserted_rows   int not null default 0,
  duplicate_rows  int not null default 0,
  skipped_rows    int not null default 0,
  error_rows      int not null default 0,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index idx_imports_org_time on imports (org_id, created_at desc);
create trigger trg_imports_updated before update on imports
  for each row execute function set_updated_at();

-- ── import_rows: raw staged rows + outcome (ingestion audit trail) ───────────
create table import_rows (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  import_id      uuid not null references imports(id) on delete cascade,
  row_number     int not null,
  raw            jsonb not null,
  external_ref   text,
  status         row_status not null default 'pending',
  error_message  text,
  transaction_id uuid references fuel_transactions(id),
  created_at     timestamptz not null default now()
);
create index idx_import_rows_import on import_rows (import_id);
create index idx_import_rows_extref on import_rows (org_id, external_ref);

-- ── declined_transactions: Reject Report risk stream (docs/08 §3.1) ──────────
create table declined_transactions (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  import_id         uuid references imports(id) on delete set null,
  declined_at       timestamptz not null,
  card_ref          text,
  invoice           text,
  unit              text,
  vehicle_id        uuid references vehicles(id) on delete set null,
  driver_ext_id     text,
  driver_id         uuid references drivers(id) on delete set null,
  location_text     text,
  city              text,
  state             text,
  error_code        text,
  error_description text,
  external_ref      text,
  created_at        timestamptz not null default now()
);
create index idx_declined_org_time on declined_transactions (org_id, declined_at desc);
create unique index idx_declined_external_ref
  on declined_transactions (org_id, external_ref) where external_ref is not null;

-- ── fuel_transactions: link to its import (external_ref already exists, 0003) ─
alter table fuel_transactions
  add column import_id uuid references imports(id) on delete set null;

-- ── RLS: read = org members; write = admin/fleet_manager (managers run imports) ─
alter table fuel_cards enable row level security;
create policy fuel_cards_select on fuel_cards for select using (org_id = auth_org_id());
create policy fuel_cards_write on fuel_cards for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

alter table imports enable row level security;
create policy imports_select on imports for select using (org_id = auth_org_id());
create policy imports_write on imports for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

alter table import_rows enable row level security;
create policy import_rows_select on import_rows for select using (org_id = auth_org_id());
create policy import_rows_write on import_rows for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

alter table declined_transactions enable row level security;
create policy declined_select on declined_transactions for select using (org_id = auth_org_id());
create policy declined_write on declined_transactions for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));


-- ============================================================================
-- 0008_ai_verifications.sql
-- ============================================================================
-- FuelGuard — 0008 AI verification layer (docs/07-AI-VERIFICATION.md §5)
-- Stores Claude's explainable risk assessment for flagged transactions. The kill-switch
-- (anomaly_thresholds.ai_verification_enabled) and budget (ai_monthly_token_budget) and the
-- denormalized fuel_transactions.ai_risk_level column already exist (migration 0003).

create table ai_verifications (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  transaction_id     uuid not null references fuel_transactions(id) on delete cascade,
  anomaly_id         uuid references anomalies(id) on delete set null,
  model              text not null,                 -- 'claude-haiku-4-5' | 'claude-sonnet-4-6'
  risk_score         int not null,                  -- 0-100
  risk_level         anomaly_severity not null,
  location_plausible boolean,
  implied_speed_mph  numeric(6,1),
  summary            text not null,
  recommended_action text not null,                 -- monitor|investigate|contact_driver|block_card|none
  contributing_factors text[] not null default '{}',
  confidence         numeric(4,3),                  -- 0.000-1.000
  raw_response       jsonb not null default '{}',
  input_hash         text not null,                 -- cache key / dedup
  token_usage        jsonb,                         -- {input, output}
  created_at         timestamptz not null default now()
);
create index idx_ai_verifications_org_time on ai_verifications (org_id, created_at desc);
create index idx_ai_verifications_txn on ai_verifications (transaction_id);
create unique index idx_ai_verifications_cache on ai_verifications (org_id, input_hash);

-- RLS: read = org members; writes are service-role only (the API performs them).
alter table ai_verifications enable row level security;
create policy ai_verifications_select on ai_verifications
  for select using (org_id = auth_org_id());


-- ============================================================================
-- 0009_notifications_audit_triggers.sql
-- ============================================================================
-- FuelGuard — 0009 notification settings + audit triggers (Phase 8 hardening)
-- docs/03-ROADMAP.md Phase 8, audit H9. Adds org notification config and DB-level audit triggers so
-- client-side (direct-to-Supabase) changes to vehicles/drivers/thresholds are recorded in audit_logs
-- (which is otherwise service-role-write only).

alter table organizations
  add column notification_emails text[] not null default '{}',
  add column notifications_enabled boolean not null default true;

-- ── audit trigger: generic for tables with an `id` + `org_id` (vehicles, drivers) ──
create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_id    uuid;
  v_actor uuid;
begin
  if (tg_op = 'DELETE') then
    v_org := old.org_id; v_id := old.id;
  else
    v_org := new.org_id; v_id := new.id;
  end if;
  v_actor := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;

  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id)
  values (v_org, v_actor, tg_argv[0] || '.' || lower(tg_op), tg_table_name, v_id);

  if (tg_op = 'DELETE') then return old; else return new; end if;
end;
$$;

create trigger audit_vehicles after insert or update or delete on vehicles
  for each row execute function audit_row_change('vehicle');
create trigger audit_drivers after insert or update or delete on drivers
  for each row execute function audit_row_change('driver');

-- ── audit trigger: anomaly_thresholds (PK is org_id, no `id` column) ──
create or replace function audit_threshold_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid;
begin
  insert into public.audit_logs (org_id, actor_id, action, entity, entity_id)
  values (new.org_id, v_actor, 'threshold.' || lower(tg_op), 'anomaly_thresholds', new.org_id);
  return new;
end;
$$;

create trigger audit_thresholds after insert or update on anomaly_thresholds
  for each row execute function audit_threshold_change();


-- ============================================================================
-- 0010_detection_hardening.sql
-- ============================================================================
-- FuelGuard — 0010 detection hardening (docs/09-DETECTION-REVIEW.md)
-- Adds: card identity on transactions, idempotent-anomaly index (race backstop),
-- and the new tuning thresholds for cross-source odometer tolerance, daily-mileage cap,
-- and the cumulative-overfuel / card-multi-vehicle rolling window.

-- Card identity carried onto each transaction (EFS "Card #" / fuel_cards.card_ref).
alter table fuel_transactions add column card_ref text;
create index idx_ftxn_card on fuel_transactions (org_id, card_ref, fueled_at desc);

-- Idempotency backstop: at most one *active* anomaly per (transaction, rule) — defeats the
-- read-then-insert race in the scoring service under concurrency (docs/09 P0.2).
create unique index idx_anomaly_active_rule
  on anomalies (transaction_id, rule_id)
  where status <> 'superseded';

-- New engine thresholds (defaults match the engine's built-in fallbacks).
alter table anomaly_thresholds
  add column odometer_tolerance_miles numeric(6,1) not null default 5,   -- the ±5 cross-source check
  add column max_daily_miles          int          not null default 1000, -- date-only (EFS) jump cap
  add column cumulative_window_hours  int          not null default 48;   -- overfuel / card window


-- ============================================================================
-- 0011_faithful_efs_storage.sql
-- ============================================================================
-- FuelGuard — 0011 faithful EFS report storage (docs/10)
-- The system of record: every uploaded line, every column, 1:1 with the EFS .xlsx/.csv, retained
-- for 1-year+ history and shown verbatim in the preview tables. The anomaly engine continues to use
-- the derived `fuel_transactions` (merged, fuel-only). This table is NOT transformed.

create table efs_transactions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  import_id     uuid references imports(id) on delete set null,
  line_number   int,
  external_ref  text,                 -- card|invoice|item|qty|amt (idempotent re-upload)
  -- Transaction Report columns, verbatim:
  card_num      text,                 -- "Card #"
  tran_date     date,                 -- "Tran Date" (date only, per the report)
  fueled_at     timestamptz,          -- tran_date anchored at org-local noon (for sort/joins)
  invoice       text,
  unit          text,
  driver_name   text,
  odometer      numeric(10,1),
  location_name text,
  city          text,
  state         text,                 -- "State/ Prov"
  fees          numeric(10,2),
  item          text,                 -- product code (ULSD, DEFD, SCLE, …)
  unit_price    numeric(10,3),
  qty           numeric(12,3),        -- gallons / quantity
  amt           numeric(12,2),        -- line total
  db            text,                 -- "DB" flag
  currency      text,
  created_at    timestamptz not null default now()
);
create index idx_efs_txn_org_date on efs_transactions (org_id, tran_date desc);
create index idx_efs_txn_org_unit on efs_transactions (org_id, unit, tran_date desc);
create unique index idx_efs_txn_extref
  on efs_transactions (org_id, external_ref) where external_ref is not null;

alter table efs_transactions enable row level security;
create policy efs_txn_select on efs_transactions for select using (org_id = auth_org_id());
create policy efs_txn_write on efs_transactions for all
  using (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'))
  with check (org_id = auth_org_id() and auth_role() in ('admin', 'fleet_manager'));

-- Reject Report — capture the remaining columns for a faithful 1:1 display.
alter table declined_transactions
  add column location_id text,
  add column driver_name text,
  add column policy text,
  add column policy_name text;


-- ============================================================================
-- 0012_samsara.sql
-- ============================================================================
-- FuelGuard — 0012 Samsara telematics integration (docs/10)
-- Maps fleet vehicles to Samsara, stores the per-org API token (server-only), and records the
-- reconciliation result on each scored transaction (Samsara odometer + recovered fueling time +
-- whether the truck was actually at the EFS station's location).

alter table vehicles add column samsara_vehicle_id text;

-- Per-org integration secrets. Service-role only — never exposed to the browser.
create table integration_credentials (
  org_id           uuid primary key references organizations(id) on delete cascade,
  provider         text not null default 'samsara',
  samsara_api_token text,
  enabled          boolean not null default true,
  last_synced_at   timestamptz,
  updated_at       timestamptz not null default now()
);
alter table integration_credentials enable row level security;
-- No client policies → only the service role (API) can read/write the token.

-- Station city/state on the scored transaction (needed to match the EFS location to Samsara).
alter table fuel_transactions
  add column city  text,
  add column state text;

-- Reconciliation result on the scored transaction.
alter table fuel_transactions
  add column samsara_odometer        numeric(10,1),
  add column samsara_location_matched boolean,
  add column samsara_recon_at        timestamptz;


-- ============================================================================
-- 0013_tank_fill.sql
-- ============================================================================
-- FuelGuard — 0013 Tank-fill reconciliation (docs/10 §8 — soft / advisory signal)
-- Records the Samsara tank-level check on each scored transaction: how many gallons the tank actually
-- rose across the fueling moment, and how far short of the billed gallons that came (if any). The
-- sensor is coarse, so the `tank_fill_short` rule is low-severity and uses a generous tolerance.

alter table fuel_transactions
  add column samsara_tank_observed_gal numeric(10,1),  -- observed tank rise across the fill
  add column samsara_tank_short_gal    numeric(10,1);  -- gallons billed beyond the observed rise (>0 = short)

