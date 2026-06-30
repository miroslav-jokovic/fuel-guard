-- FleetGuard — 0012 Samsara telematics integration (docs/10)
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
