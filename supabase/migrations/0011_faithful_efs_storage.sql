-- FleetGuard — 0011 faithful EFS report storage (docs/10)
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
