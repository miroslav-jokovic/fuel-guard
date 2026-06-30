-- FleetGuard — 0007 fuel-card import tables
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
