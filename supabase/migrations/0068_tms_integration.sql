-- TMS (dispatch) integration — first provider: McLeod LoadMaster.
--
-- Built OPT-IN and per-provider so it ONLY affects orgs that connect it; every other tenant is completely
-- untouched (this is a selectable module, not a global change). The data arrives via an outbound on-prem
-- sync agent that reads the carrier's LoadMaster `ws` API locally and POSTs normalized rows to our ingest
-- endpoints — so nothing here reaches into the carrier's private network.

-- Per-org, per-provider enablement + the shared secret the sync agent presents to the ingest endpoints.
-- Service-role only (it holds a secret) — same posture as integration_credentials.
create table if not exists org_integrations (
  org_id         uuid not null references organizations(id) on delete cascade,
  provider       text not null,                  -- 'mcleod' (future: other TMS / dispatch systems)
  enabled        boolean not null default false,
  ingest_token   text,                           -- bearer the sync agent presents to POST movements/time-off
  config         jsonb not null default '{}',    -- non-secret settings (host label, field mappings, …)
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (org_id, provider)
);
alter table org_integrations enable row level security;
-- No client policies → only the service role (API) reads/writes (it holds the ingest secret).

-- Movements / loads pulled from the TMS. `temperature_controlled` is THE signal that fixes reefer alerts:
-- a reefer-hauling truck that pulled no temp-controlled load in the window had no reason to buy reefer fuel.
create table if not exists tms_movements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  provider      text not null default 'mcleod',
  external_id   text not null,                  -- movement / order id in the TMS
  vehicle_id    uuid references vehicles(id) on delete set null,
  trailer_id    uuid references trailers(id) on delete set null,
  started_at    timestamptz,
  ended_at      timestamptz,
  temperature_controlled boolean not null default false,
  setpoint_f    numeric(5,1),
  commodity     text,
  raw           jsonb not null default '{}',
  synced_at     timestamptz not null default now()
);
create unique index if not exists idx_tms_movements_ext on tms_movements (org_id, provider, external_id);
create index if not exists idx_tms_movements_veh on tms_movements (org_id, vehicle_id, started_at desc);
alter table tms_movements enable row level security;
create policy tms_movements_select on tms_movements for select using (org_id = auth_org_id());
-- Writes: service role only (the ingest endpoint); no client write policy.

-- Driver home time / time-off windows from the TMS. A fill / idle / off-hours signal inside one of these is
-- explained by the driver being home, so it can be suppressed or annotated instead of alerting.
create table if not exists driver_time_off (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  provider    text not null default 'mcleod',
  external_id text,
  driver_id   uuid references drivers(id) on delete set null,
  start_at    timestamptz not null,
  end_at      timestamptz,
  kind        text,                             -- home_time | pto | unavailable
  raw         jsonb not null default '{}',
  synced_at   timestamptz not null default now()
);
create index if not exists idx_driver_time_off_drv on driver_time_off (org_id, driver_id, start_at desc);
create unique index if not exists idx_driver_time_off_ext
  on driver_time_off (org_id, provider, external_id) where external_id is not null;
alter table driver_time_off enable row level security;
create policy driver_time_off_select on driver_time_off for select using (org_id = auth_org_id());
